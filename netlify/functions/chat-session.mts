import type { Config, Context } from "@netlify/functions";
import { neon } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";

function db(context: Context) {
  const url = context.netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return neon(url);
}

function limit() {
  const value = Number(process.env.ANONYMOUS_CHAT_MESSAGE_LIMIT ?? "30");
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) return 30;
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function capabilityFrom(req: Request) {
  const value = req.headers.get("x-chat-capability")?.trim();
  if (!value || value.length < 32) throw new Error("Chat session not found.");
  return value;
}

async function requireSession(sql: ReturnType<typeof neon>, capability: string) {
  const rows = await sql`
    SELECT id, capability, expires_at, remaining_messages
    FROM anonymous_sessions
    WHERE capability = ${capability}
      AND revoked_at IS NULL
      AND expires_at > ${Date.now()}
    LIMIT 1
  `;
  if (!rows[0]) throw new Error("Chat session not found.");
  return rows[0];
}

export default async function handler(req: Request, context: Context) {
  try {
    const sql = db(context);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "threads";

    if (req.method === "POST" && action === "session") {
      if (process.env.ANONYMOUS_CHAT_ENABLED === "false") {
        return json({ error: "Anonymous chat is currently disabled." }, 503);
      }
      const capability = randomBytes(32).toString("base64url");
      const now = Date.now();
      await sql`
        INSERT INTO anonymous_sessions (capability, created_at, expires_at, remaining_messages)
        VALUES (${capability}, ${now}, ${now + 7 * 24 * 60 * 60 * 1000}, ${limit()})
      `;
      return json({ capability });
    }

    const capability = capabilityFrom(req);
    const session = await requireSession(sql, capability);

    if (req.method === "POST" && action === "thread") {
      const count = await sql`
        SELECT count(*)::int AS count
        FROM chat_threads
        WHERE session_id = ${session.id}
      `;
      if (Number(count[0]?.count ?? 0) >= 20) {
        return json({ error: "This chat session has too many conversations." }, 400);
      }
      const now = Date.now();
      const rows = await sql`
        INSERT INTO chat_threads (session_id, title, created_at, updated_at, next_order)
        VALUES (${session.id}, 'New conversation', ${now}, ${now}, 0)
        RETURNING id, title, created_at, updated_at
      `;
      return json({
        thread: {
          id: rows[0].id,
          title: rows[0].title,
          createdAt: Number(rows[0].created_at),
          updatedAt: Number(rows[0].updated_at),
        },
      });
    }

    if (req.method === "GET" && action === "threads") {
      const rows = await sql`
        SELECT id, title, created_at, updated_at
        FROM chat_threads
        WHERE session_id = ${session.id}
        ORDER BY updated_at DESC
      `;
      return json({
        threads: rows.map((row) => ({
          id: row.id,
          title: row.title,
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        })),
      });
    }

    if (req.method === "GET" && action === "messages") {
      const threadId = url.searchParams.get("threadId");
      if (!threadId) return json({ error: "threadId is required." }, 400);
      const rows = await sql`
        SELECT cm.message
        FROM chat_messages cm
        JOIN chat_threads ct ON ct.id = cm.thread_id
        WHERE ct.id = ${threadId}
          AND ct.session_id = ${session.id}
        ORDER BY cm."order" ASC
        LIMIT 50
      `;
      return json({ messages: rows.map((row) => row.message) });
    }

    if (req.method === "GET" && action === "active-run") {
      const threadId = url.searchParams.get("threadId");
      if (!threadId) return json({ error: "threadId is required." }, 400);
      const rows = await sql`
        SELECT cr.id AS run_id, cr.status, cr.updated_at
        FROM chat_runs cr
        JOIN chat_threads ct ON ct.id = cr.thread_id
        WHERE ct.id = ${threadId}
          AND ct.session_id = ${session.id}
          AND ct.active_run_id = cr.id
          AND cr.status IN ('scheduled','streaming')
        LIMIT 1
      `;
      const run = rows[0];
      if (!run || Date.now() - Number(run.updated_at) >= 2 * 60 * 1000) {
        return json({ run: null });
      }
      return json({ run: { runId: run.run_id, status: run.status } });
    }

    return json({ error: "Unsupported chat action." }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Chat request failed." }, 400);
  }
}

export const config: Config = {
  path: "/api/chat-session",
};