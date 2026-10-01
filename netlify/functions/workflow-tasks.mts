import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function requireAuth(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "content-type": "application/json" } });
  return jwtVerify(header.slice(7).trim(), jwks, { issuer: AUTH_URL });
}

function database() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

export default async (request: Request) => {
  try {
    await requireAuth(request);
    const sql = database();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (request.method === "GET") {
      const rows = await sql`
        select t.*, l.name as lead_name
        from workflow_tasks t
        left join leads l on l.id = t.lead_id
        order by case when t.status = 'open' then 0 else 1 end, t.updated_at desc
        limit 200
      `;
      return json({ ok: true, tasks: rows.map((row) => ({ task: row, lead: row.lead_name ? { name: row.lead_name } : null })) });
    }

    if (request.method === "PATCH") {
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const input = await request.json() as { status?: string };
      if (input.status !== "open" && input.status !== "done") return json({ ok: false, error: "status must be open or done" }, 400);
      const now = Date.now();
      const rows = await sql`update workflow_tasks set status = ${input.status}, updated_at = ${now} where id = ${id} returning *`;
      if (!rows[0]) return json({ ok: false, error: "Task not found" }, 404);
      return json({ ok: true, task: rows[0] });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Workflow tasks API error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Workflow task request failed" }, 500);
  }
};

export const config: Config = { path: "/api/workflow-tasks" };
