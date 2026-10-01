import { jsonSchema, tool, type ToolSet } from "ai"

import { callMacalyJson } from "./macaly"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import type { ActionCtx } from "./_generated/server"

/**
 * Prebuilt assistant tools. They execute inside the server-side generation
 * action; Macaly credentials never reach the browser. Toggle tools by editing
 * ENABLED_TOOLS (setup.mjs writes it from its --tools flag). Add new tools to
 * ALL_TOOLS with jsonSchema inputs — do not switch to zod schemas, the
 * installed zod version does not type-check against AI SDK tool generics.
 */
export const ENABLED_TOOLS: string[] = ["captureLead"]

const internetSearch = tool({
  description:
    "Search the internet for up-to-date information. Use for current events, " +
    "recent facts, or anything beyond your training knowledge, then answer " +
    "using the findings.",
  inputSchema: jsonSchema<{ query: string }>({
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
    additionalProperties: false,
  }),
  execute: async ({ query }) => {
    const data = await callMacalyJson("/api/client-app/internet-search", {
      query,
    })
    return {
      result: String(data.result ?? ""),
      citations: (Array.isArray(data.citations) ? data.citations : []).slice(
        0,
        8,
      ),
    }
  },
})

const generateImage = tool({
  description:
    "Generate an image from a text prompt. Returns a permanent imageUrl that " +
    "the chat UI renders inline automatically.",
  inputSchema: jsonSchema<{ prompt: string }>({
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Detailed description of the image to generate",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  }),
  execute: async ({ prompt }) => {
    const data = await callMacalyJson("/api/client-app/ai-image", {
      intent: "generate",
      prompt,
    })
    return { imageUrl: String(data.imageUrl ?? "") }
  },
})

function captureLeadTool(ctx: ActionCtx, threadId: Id<"chatThreads">) {
  return tool({
    description:
      "Create a structured Jabari Tech project lead after the visitor has clearly expressed hiring intent and you have collected their name, email, what they need, budget if provided, and timeline if provided. Do not call this for casual questions or incomplete enquiries.",
    inputSchema: jsonSchema<{
      name: string
      email: string
      company: string
      request: string
      budget: string
      timeline: string
    }>({
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        company: { type: "string" },
        request: { type: "string" },
        budget: { type: "string" },
        timeline: { type: "string" },
      },
      required: ["name", "email", "company", "request", "budget", "timeline"],
      additionalProperties: false,
    }),
    execute: async (lead) => {
      return await ctx.runMutation(internal.leads.capture, {
        threadId,
        ...lead,
      })
    },
  })
}

export function buildEnabledTools(
  ctx?: ActionCtx,
  threadId?: Id<"chatThreads">,
): ToolSet {
  const allTools = {
    internetSearch,
    generateImage,
    ...(ctx && threadId ? { captureLead: captureLeadTool(ctx, threadId) } : {}),
  }
  return Object.fromEntries(
    Object.entries(allTools).filter(([name]) => ENABLED_TOOLS.includes(name)),
  )
}

export function toolSystemPrompt(): string {
  const parts: string[] = []
  if (ENABLED_TOOLS.includes("internetSearch")) {
    parts.push(
      "Use the internetSearch tool for current events or facts you are " +
        "unsure about.",
    )
  }
  if (ENABLED_TOOLS.includes("generateImage")) {
    parts.push(
      "Use the generateImage tool whenever the user asks for an image.",
    )
  }
  return parts.join(" ")
}
