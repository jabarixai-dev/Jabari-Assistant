import type { Config, Context } from "@netlify/functions"
import { neon } from "@neondatabase/serverless"
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai"
import { createMacalyLanguageModel } from "./lib/macaly-model"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function db(context: Context) {
  const url = context.netlify.env.get("DATABASE_URL")
  if (!url) throw new Error("DATABASE_URL is not configured.")
  return neon(url)
}

async function requireSession(sql: ReturnType<typeof neon>, capability: string) {
  const rows = await sql`
    SELECT id, remaining_messages
    FROM anonymous_sessions
    WHERE capability = ${capability}
      AND revoked_at IS NULL
      AND expires_at > ${Date.now()}
    LIMIT 1
  `
  if (!rows[0]) throw new Error("Chat session not found.")
  return rows[0]
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  if (message.includes("rate limit")) return "Support is busy. Please retry shortly."
  if (message.includes("credits")) return "This workspace needs more AI credits."
  return "The assistant could not generate a reply. Please retry."
}

export default async function handler(req: Request, context: Context) {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405)

  try {
    const capability = req.headers.get("x-chat-capability")?.trim()
    if (!capability || capability.length < 32) throw new Error("Chat session not found.")

    const body = (await req.json()) as {
      threadId?: string
      messages?: UIMessage[]
    }
    if (!body.threadId) return json({ error: "threadId is required." }, 400)
    if (!Array.isArray(body.messages)) return json({ error: "messages are required." }, 400)

    const sql = db(context)
    const session = await requireSession(sql, capability)

    const threads = await sql`
      SELECT id, title, next_order
      FROM chat_threads
      WHERE id = ${body.threadId} AND session_id = ${session.id}
      LIMIT 1
    `
    const thread = threads[0]
    if (!thread) throw new Error("Conversation not found.")

    const userMessage = body.messages.at(-1)
    if (!userMessage || userMessage.role !== "user") {
      throw new Error("A user message is required.")
    }

    const text = userMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim()
    if (!text) throw new Error("A non-empty user message is required.")

    const existing = await sql`
      SELECT id FROM chat_messages
      WHERE thread_id = ${thread.id} AND message_id = ${userMessage.id}
      LIMIT 1
    `
    if (!existing[0]) {
      if (Number(session.remaining_messages) < 1) {
        throw new Error("This anonymous chat has reached its message limit.")
      }
      const now = Date.now()
      await sql`
        INSERT INTO chat_messages
          (thread_id, message_id, role, message, "order", created_at)
        VALUES
          (${thread.id}, ${userMessage.id}, 'user', ${JSON.stringify({
            id: userMessage.id,
            role: "user",
            parts: [{ type: "text", text }],
          })}::jsonb, ${Number(thread.next_order ?? 0)}, ${now})
      `
      await sql`
        UPDATE anonymous_sessions
        SET remaining_messages = remaining_messages - 1
        WHERE id = ${session.id}
      `
      await sql`
        UPDATE chat_threads
        SET next_order = ${Number(thread.next_order ?? 0) + 1}, updated_at = ${now}
        WHERE id = ${thread.id}
      `
    }

    const history = await sql`
      SELECT message
      FROM chat_messages
      WHERE thread_id = ${thread.id}
      ORDER BY "order" ASC
      LIMIT 50
    `
    const originalMessages = history.map((row) => row.message as UIMessage)

    const settingsRows = await sql`
      SELECT identity, services, tone, qualification, boundaries
      FROM agent_settings
      ORDER BY updated_at DESC
      LIMIT 1
    `
    const settings = settingsRows[0]

    const result = streamText({
      model: createMacalyLanguageModel({
        baseUrl: context.netlify.env.get("MACALY_BASE_URL") ?? "",
        apiToken: context.netlify.env.get("MACALY_API_TOKEN") ?? "",
        chatId: context.netlify.env.get("MACALY_CHAT_ID") ?? "",
        bypassHeader: context.netlify.env.get("MACALY_BYPASS_HEADER"),
        preset: "CODE",
      }),
      system: [
        "You are the AI representative for Jabari Tech.",
        "Be concise, professional, helpful, and honest.",
        "Use only the supplied business profile; never invent clients, prices, guarantees, or results.",
        settings?.identity ? "Identity: " + settings.identity : "",
        settings?.services ? "Services: " + settings.services : "",
        settings?.tone ? "Tone: " + settings.tone : "",
        settings?.qualification ? "Qualification rules: " + settings.qualification : "",
        settings?.boundaries ? "Boundaries: " + settings.boundaries : "",
        "When a visitor clearly wants to hire Jabari Tech, collect their name, email, company, request, budget, and timeline before saying the enquiry is recorded.",
      ].filter(Boolean).join(" "),
      messages: await convertToModelMessages(originalMessages),
      onFinish: async ({ response }) => {
        const responseMessage = response.messages.at(-1)
        if (!responseMessage) return
        const assistant = {
          id: responseMessage.id,
          role: "assistant",
          parts: responseMessage.content,
        }
        const now = Date.now()
        await sql`
          INSERT INTO chat_messages
            (thread_id, message_id, role, message, "order", created_at)
          VALUES
            (${thread.id}, ${assistant.id}, 'assistant', ${JSON.stringify(assistant)}::jsonb,
             ${Number(thread.next_order ?? 0) + 1}, ${now})
          ON CONFLICT (thread_id, message_id) DO NOTHING
        `
        await sql`
          UPDATE chat_threads
          SET next_order = ${Number(thread.next_order ?? 0) + 2}, updated_at = ${now}
          WHERE id = ${thread.id}
        `
      },
    })

    return result.toUIMessageStreamResponse({
      originalMessages,
      onError: publicError,
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Chat request failed." }, 400)
  }
}

export const config: Config = {
  path: "/api/chat",
}
