"use node"

import {
  convertToModelMessages,
  generateText,
  type UIMessage,
} from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { internalAction } from "./_generated/server"

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
        "Use the following Jabari Tech business information as context.",

        "Identity: " + settings.identity,
        "Services: " + settings.services,
        "Tone: " + settings.tone,
        "Qualification rules: " + settings.qualification,
        "Boundaries: " + settings.boundaries,

        "For now, do not attempt to call external tools or capture leads.",
        "If a visitor shows genuine interest in hiring Jabari Tech, ask for the information needed to understand their project.",
      ].join(" ")

      const messages = await convertToModelMessages(
        originalMessages,
      )

      console.log(
        "[gemini-agent] Sending request to Gemini...",
      )

      const result = await generateText({
        model: google("gemini-3.8-flash"),
        system: systemPrompt,
        messages,
      })

      console.log(
        "[gemini-agent] Gemini response received.",
      )

      const text = result.text?.trim()

      if (!text) {
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
            text,
          },
        ],
      }

      await ctx.runMutation(
        internal.agentChat.completeRun,
        {
          runId: args.runId,
          attemptId,
          message: assistantMessage,
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
