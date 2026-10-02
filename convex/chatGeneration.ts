"use node"

import {
  convertToModelMessages,
  generateText,
  stepCountIs,
  type UIMessage,
} from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"
import { buildEnabledTools, toolSystemPrompt } from "./agentTools"

function requiredEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required Convex environment variable: ${name}`)
  }

  return value
}

function publicError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error)

  console.error("[gemini-agent] REAL GENERATION ERROR:", error)

  if (
    message.toLowerCase().includes("rate limit") ||
    message.includes("429")
  ) {
    return "Support is busy right now. Please retry shortly."
  }

  if (
    message.toLowerCase().includes("api key") ||
    message.toLowerCase().includes("authentication") ||
    message.toLowerCase().includes("unauthorized") ||
    message.includes("401") ||
    message.includes("403")
  ) {
    return "The assistant is temporarily unavailable. Please retry shortly."
  }

  return "The assistant could not generate a reply. Please retry."
}

function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const generateReply = internalAction({
  args: {
    runId: v.id("chatRuns"),
  },

  returns: v.null(),

  handler: async (ctx, args) => {
    const attemptId = crypto.randomUUID()

    const claimed = await ctx.runMutation(
      internal.agentChat.claimRun,
      {
        runId: args.runId,
        attemptId,
      },
    )

    if (!claimed) {
      return null
    }

    try {
      const originalMessages = claimed.messages as UIMessage[]

      const settings = await ctx.runQuery(
        internal.agentSettings.internalGet,
        {},
      )

      const google = createGoogleGenerativeAI({
        apiKey: requiredEnv("GEMINI_API_KEY"),
      })

      const systemPrompt = [
        "You are the AI representative for Jabari Tech.",
        "Answer clearly, professionally, and helpfully.",
        "Use the configured Jabari Tech business profile as the source of truth.",

        "Identity: " + settings.identity,
        "Services: " + settings.services,
        "Tone: " + settings.tone,
        "Qualification rules: " + settings.qualification,
        "Boundaries: " + settings.boundaries,

        "When a visitor has genuine hiring intent, collect enough information to understand the project.",
        "Before capturing a lead, make sure you have the visitor's name, email, what they need, company if applicable, budget if provided, and timeline if provided.",
        "Do not capture casual questions or incomplete enquiries.",
        "Use captureLead exactly once when the enquiry contains genuine hiring intent and sufficient information.",
        "After a successful captureLead call, tell the visitor that their enquiry has been recorded.",
        "Do not invent a response time.",
        toolSystemPrompt(),
      ].join(" ")

      const messages = await convertToModelMessages(
        originalMessages,
      )

      const tools = buildEnabledTools(
        ctx,
        claimed.threadId,
      )

      console.log(
        "[gemini-agent] Sending Gemini request with tools:",
        Object.keys(tools),
      )

      const result = await generateText({
        model: google("gemini-3.8-flash"),
        system: systemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(4),
      })

      console.log(
        "[gemini-agent] Gemini response received.",
      )

      const text = result.text?.trim()

      const toolResults = result.steps?.some(
        (step) =>
          Array.isArray(step.toolResults) &&
          step.toolResults.length > 0,
      )

      if (!text && !toolResults) {
        throw new Error(
          "Gemini returned an empty response.",
        )
      }

      const assistantMessage: UIMessage = {
        id: claimed.assistantMessageId,
        role: "assistant",
        parts: [
          {
            type: "text",
            text:
              text ||
              "Your enquiry has been recorded.",
          },
        ],
      }

      await ctx.runMutation(
        internal.agentChat.completeRun,
        {
          runId: args.runId,
          attemptId,
          message: serializable(assistantMessage),
        },
      )

      console.log(
        "[gemini-agent] Run completed successfully.",
      )
    } catch (error) {
      console.error(
        "[gemini-agent] REAL GENERATION ERROR:",
        error,
      )

      await ctx.runMutation(
        internal.agentChat.failRun,
        {
          runId: args.runId,
          attemptId,
          error: publicError(error),
        },
      )
    }

    return null
  },
})
