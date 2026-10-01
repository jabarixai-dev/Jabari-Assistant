import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";
import { fireTrigger, processDue } from "./workflow-engine.mts";

const AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const OWNER_EMAIL = "jabari.tech.org@gmail.com";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function requireOwner(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  }
  const verified = await jwtVerify(header.slice(7).trim(), jwks, { issuer: AUTH_URL });
  const email = typeof verified.payload.email === "string" ? verified.payload.email.toLowerCase() : "";
  if (email !== OWNER_EMAIL) {
    throw new Response(JSON.stringify({ error: "Owner access required" }), { status: 403 });
  }
}

function db() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

export default async (request: Request) => {
  try {
    await requireOwner(request);
    const sql = db();
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") ?? "leads";
    const id = url.searchParams.get("id");

    if (request.method === "GET" && resource === "leads") {
      const search = url.searchParams.get("search")?.trim() ?? "";
      const status = url.searchParams.get("status")?.trim() ?? "";
      const rows = search || status
        ? await sql`
            select l.*,
              coalesce((select count(*)::integer from crm_activities a where a.lead_id = l.id), 0) as activity_count
            from leads l
            where (${search} = '' or l.name ilike ${"%" + search + "%"}
              or l.email ilike ${"%" + search + "%"}
              or l.company ilike ${"%" + search + "%"}
              or l.request ilike ${"%" + search + "%"})
              and (${status} = '' or l.status = ${status})
            order by l.updated_at desc limit 200
          `
        : await sql`
            select l.*,
              coalesce((select count(*)::integer from crm_activities a where a.lead_id = l.id), 0) as activity_count
            from leads l order by l.updated_at desc limit 200
          `;
      return json({ ok: true, leads: rows });
    }
    if (request.method === "GET" && resource === "lead") {
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const leadRows = await sql`select * from leads where id = ${id} limit 1`;
      if (!leadRows[0]) return json({ ok: false, error: "Lead not found" }, 404);
      const lead = leadRows[0];
      const messages = lead.thread_id
        ? await sql`
            select id, message_id, role, message, "order", created_at
            from chat_messages where thread_id = ${lead.thread_id}
            order by "order" asc limit 100
          `
        : [];
      const contacts = await sql`
        select * from contacts where lower(email) = lower(${lead.email})
        order by updated_at desc limit 1
      `;
      const activities = await sql`
        select * from crm_activities where lead_id = ${id}
        order by created_at desc limit 100
      `;
      return json({ ok: true, lead, messages, contact: contacts[0] ?? null, activities });
    }

    if (request.method === "PATCH" && resource === "lead-status") {
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const input = await request.json() as Record<string, unknown>;
      const nextStatus = String(input.status ?? "").trim();
      const allowed = new Set(["new", "contacted", "qualified", "won", "lost"]);
      if (!allowed.has(nextStatus)) return json({ ok: false, error: "Invalid lead status" }, 400);

      const currentRows = await sql`select * from leads where id = ${id} limit 1`;
      const current = currentRows[0];
      if (!current) return json({ ok: false, error: "Lead not found" }, 404);
      if (current.status === nextStatus) return json({ ok: true, lead: current });

      const now = Date.now();
      const rows = await sql`
        update leads set status = ${nextStatus}, updated_at = ${now}
        where id = ${id} returning *
      `;

      const contacts = await sql`
        select id from contacts where lower(email) = lower(${current.email})
        order by updated_at desc limit 1
      `;
      await sql`
        insert into crm_activities (id, contact_id, lead_id, type, title, detail, created_at)
        values (${crypto.randomUUID()}, ${contacts[0]?.id ?? null}, ${id},
          'status_changed', 'Lead status changed',
          ${String(current.status) + " → " + nextStatus}, ${now})
      `;
      await fireTrigger(sql, "stage_changed", id, nextStatus).catch((e) => console.error("Workflow trigger error", e));
      await processDue(sql).catch((e) => console.error("Workflow process error", e));
      return json({ ok: true, lead: rows[0] });
    }

    return json({ ok: false, error: "Unsupported Leads operation" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Leads API error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Leads request failed" }, 500);
  }
};

export const config: Config = { path: "/api/leads" };
