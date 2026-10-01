"use node"

import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
  type UIMessageChunk,
} from "ai"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"
import { buildEnabledTools, toolSystemPrompt } from "./agentTools"
import { createMacalyLanguageModel } from "./macalyModel"

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required Convex environment variable: ${name}`)
  return value
}
function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Reply generation failed."
  if (message.includes("rate limit")) return "Support is busy. Please retry shortly."
  if (message.includes("credits")) return "This workspace needs more AI credits."
  return "The assistant could not generate a reply. Please retry."
}
function serializable<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }

export const generateReply = internalAction({
  args: { runId: v.id("chatRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attemptId = crypto.randomUUID()
    const claimed = await ctx.runMutation(internal.agentChat.claimRun, { runId: args.runId, attemptId })
    if (!claimed) return null
    try {
      const originalMessages = claimed.messages as UIMessage[]
      const settings = await ctx.runQuery(internal.agentSettings.internalGet, {})
      const result = streamText({
        model: createMacalyLanguageModel({
          baseUrl: requiredEnv("MACALY_BASE_URL"),
          apiToken: requiredEnv("MACALY_API_TOKEN"),
          chatId: requiredEnv("MACALY_CHAT_ID"),
          bypassHeader: process.env.MACALY_BYPASS_HEADER,
          preset: "CODE",
        }),
        system: [
          "You are the AI representative for Jabari Tech.",
          "Use the configured business profile, tone, qualification rules, and boundaries below as the source of truth.",
          "Identity: " + settings.identity,
          "Services: " + settings.services,
          "Tone: " + settings.tone,
          "Qualification rules: " + settings.qualification,
          "Boundaries: " + settings.boundaries,
          "When enough genuine hiring intent and project information is available, use captureLead exactly once. Do not capture casual or incomplete enquiries.",
          "After successful capture, say the enquiry has been recorded without inventing a response time.",
          toolSystemPrompt(),
        ].join(" "),
        messages: await convertToModelMessages(originalMessages),
        tools: buildEnabledTools(ctx, claimed.threadId),
        stopWhen: stepCountIs(4),
      })
      let finalMessage: UIMessage | undefined
      let streamError: unknown
      const stream = result.toUIMessageStream({
        originalMessages,
        generateMessageId: () => claimed.assistantMessageId,
        onEnd: ({ responseMessage }) => { finalMessage = responseMessage },
        onError: (error) => {
          streamError = error
          console.error("[durable-agent] Model stream failed", error)
          return publicError(error)
        },
      })
      const pending: UIMessageChunk[] = []
      let lastFlush = Date.now()
      const flush = async () => {
        if (!pending.length) return
        const chunks = pending.splice(0, pending.length).map(serializable)
        await ctx.runMutation(internal.agentChat.appendChunks, { runId: args.runId, attemptId, chunks })
        lastFlush = Date.now()
      }
      for await (const chunk of stream) {
        pending.push(chunk)
        if (pending.length >= 24 || Date.now() - lastFlush >= 120) await flush()
      }
      await flush()
      if (streamError) throw streamError
      if (!finalMessage) throw new Error("AI SDK stream ended without a response message.")
      const hasVisibleContent = finalMessage.parts.some(
        (part) => (part.type === "text" && part.text.trim().length > 0) || part.type.startsWith("tool-"),
      )
      if (!hasVisibleContent) throw new Error("The model returned an empty reply.")
      await ctx.runMutation(internal.agentChat.completeRun, {
        runId: args.runId, attemptId, message: serializable(finalMessage),
      })
    } catch (error) {
      await ctx.runMutation(internal.agentChat.failRun, { runId: args.runId, attemptId, error: publicError(error) })
    }
    return null
  },
})
