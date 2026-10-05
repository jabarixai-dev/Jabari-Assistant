"use node"

import { generateText } from "ai"
import { google } from "@ai-sdk/google"
import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { action } from "./_generated/server"
import { internal } from "./_generated/api"

function env(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required Convex environment variable: ${name}`)
  return value
}

function clean(value: unknown, fallback = "Not provided") {
  const text = String(value ?? "").trim()
  return text || fallback
}

export const analyzeLead = action({
  args: { leadId: v.id("leads"), focus: v.optional(v.string()) },
  returns: v.object({
    summary: v.string(),
    qualification: v.string(),
    recommendation: v.string(),
    draft: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error("Authentication required.")

    const detail = await ctx.runQuery(internal.leads.getLeadForCopilot, { leadId: args.leadId })
    if (!detail?.lead) throw new Error("Lead not found.")

    const lead = detail.lead
    const activities = (detail.activities ?? []).slice(0, 20).map((item: any) =>
      `- ${clean(item.title)}: ${clean(item.detail)}`
    ).join("\n")

    const conversation = (detail.messages ?? []).slice(-30).map((message: any) => {
      const text = (message.parts ?? [])
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text ?? "")
        .join("")
        .trim()
      return text ? `${message.role === "user" ? "Visitor" : "Assistant"}: ${text}` : ""
    }).filter(Boolean).join("\n")

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash"
    const result = await generateText({
      model: google(model),
      temperature: 0.2,
      system: [
        "You are Jabari Tech's internal Lead Copilot.",
        "Analyze CRM lead information factually. Do not invent facts, prices, commitments, or customer intent.",
        "This is an internal sales workspace. Recommend actions, but never claim an action was executed.",
        "Return exactly four labeled sections: SUMMARY, QUALIFICATION, RECOMMENDATION, DRAFT.",
        "SUMMARY: 2-4 concise sentences about the lead and what they asked for.",
        "QUALIFICATION: state evidence for fit/readiness and explicitly identify missing information.",
        "RECOMMENDATION: give one practical next step and explain why.",
        "DRAFT: write a short human-sounding follow-up email. Do not add a subject line, links, buttons, guarantees, or invented details.",
      ].join(" "),
      prompt: [
        `Lead name: ${clean(lead.name)}`,
        `Email: ${clean(lead.email)}`,
        `Company: ${clean(lead.company)}`,
        `Request: ${clean(lead.request)}`,
        `Budget: ${clean(lead.budget)}`,
        `Timeline: ${clean(lead.timeline)}`,
        `Current status: ${clean(lead.status)}`,
        `Owner focus: ${clean(args.focus, "General qualification and next action")}`,
        "",
        "Recent CRM activity:",
        activities || "None",
        "",
        "Recent visitor conversation:",
        conversation || "None",
      ].join("\n"),
    })

    const text = result.text.trim()
    const section = (name: string, next?: string) => {
      const upper = text.toUpperCase()
      const marker = name + ":"
      const start = upper.indexOf(marker)
      if (start < 0) return ""
      const contentStart = start + marker.length
      const end = next ? upper.indexOf(next + ":", contentStart) : text.length
      return text.slice(contentStart, end < 0 ? text.length : end).trim()
    }

    return {
      summary: section("SUMMARY", "QUALIFICATION") || text,
      qualification: section("QUALIFICATION", "RECOMMENDATION") || "The model did not return a separate qualification section.",
      recommendation: section("RECOMMENDATION", "DRAFT") || "Review the lead manually before taking action.",
      draft: section("DRAFT") || "",
    }
  },
})
