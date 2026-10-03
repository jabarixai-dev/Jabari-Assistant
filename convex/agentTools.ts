import { jsonSchema, tool, type ToolSet } from "ai"

import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import type { ActionCtx } from "./_generated/server"

/**
 * Native Jabari Assistant tools.
 * Macaly-backed internet search and image generation have been removed.
 */
export const ENABLED_TOOLS: string[] = ["captureLead"]

function captureLeadTool(
  ctx: ActionCtx,
  threadId: Id<"chatThreads">,
) {
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
      required: [
        "name",
        "email",
        "company",
        "request",
        "budget",
        "timeline",
      ],
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
    ...(ctx && threadId
      ? { captureLead: captureLeadTool(ctx, threadId) }
      : {}),
  }

  return Object.fromEntries(
    Object.entries(allTools).filter(([name]) =>
      ENABLED_TOOLS.includes(name),
    ),
  )
}

export function toolSystemPrompt(): string {
  return ""
}
