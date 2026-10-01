import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";
import { fireTrigger, processDue } from "./workflow-engine";

const AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const OWNER_EMAIL = "jabari.tech.org@gmail.com";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function db() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}
async function requireOwner(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "content-type": "application/json" } });
  const verified = await jwtVerify(header.slice(7).trim(), jwks, { issuer: AUTH_URL });
  const email = typeof verified.payload.email === "string" ? verified.payload.email.toLowerCase() : "";
  if (email !== OWNER_EMAIL) throw new Response(JSON.stringify({ error: "Owner access required" }), { status: 403, headers: { "content-type": "application/json" } });
}

export default async (request: Request) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "list";
    const sql = db();

    if (action === "list" || action === "create" || action === "mark-sent") await requireOwner(request);

    if (request.method === "GET" && action === "list") {
      const rows = await sql`
        select id, contact_id as "contactId", lead_id as "leadId", name, email, status,
          rating, feedback, sent_at as "sentAt", completed_at as "completedAt",
          created_at as "createdAt", updated_at as "updatedAt"
        from review_requests order by created_at desc limit 100
      `;
      return json({ ok: true, reviews: rows });
    }

    if (request.method === "POST" && action === "create") {
      const body = await request.json() as Record<string, unknown>;
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const leadId = body.leadId ? String(body.leadId) : null;
      const contactId = body.contactId ? String(body.contactId) : null;
      if (!name || !email.includes("@")) return json({ ok: false, error: "Valid name and email are required." }, 400);
      const now = Date.now(), id = crypto.randomUUID();
      await sql`insert into review_requests (id, contact_id, lead_id, name, email, status, created_at, updated_at) values (${id}, ${contactId}, ${leadId}, ${name}, ${email}, 'pending', ${now}, ${now})`;
      return json({ ok: true, id });
    }

    if (request.method === "POST" && action === "mark-sent") {
      const body = await request.json() as Record<string, unknown>;
      const id = String(body.id ?? "");
      const row = (await sql`select * from review_requests where id = ${id} limit 1`)[0] as any;
      if (!row) return json({ ok: false, error: "Review request not found." }, 404);
      const now = Date.now();
      await sql`update review_requests set status = 'sent', sent_at = ${now}, updated_at = ${now} where id = ${id}`;
      await sql`insert into crm_activities (id, contact_id, lead_id, type, title, detail, created_at) values (${crypto.randomUUID()}, ${row.contact_id}, ${row.lead_id}, 'note', 'Review request sent', 'Customer was asked for feedback.', ${now})`;
      return json({ ok: true });
    }

    if (request.method === "GET" && action === "public") {
      const id = String(url.searchParams.get("id") ?? "");
      const row = (await sql`select id, name, email, status from review_requests where id = ${id} and status = 'sent' limit 1`)[0] ?? null;
      return json({ ok: true, review: row });
    }

    if (request.method === "POST" && action === "submit") {
      const body = await request.json() as Record<string, unknown>;
      const id = String(body.id ?? "");
      const rating = Number(body.rating);
      const feedback = String(body.feedback ?? "").trim();
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return json({ ok: false, error: "Rating must be between 1 and 5." }, 400);
      const row = (await sql`select * from review_requests where id = ${id} and status = 'sent' limit 1`)[0] as any;
      if (!row) return json({ ok: false, error: "This review request is no longer available." }, 404);
      const now = Date.now();
      await sql`update review_requests set status = 'completed', rating = ${rating}, feedback = ${feedback}, completed_at = ${now}, updated_at = ${now} where id = ${id}`;
      await sql`insert into crm_activities (id, contact_id, lead_id, type, title, detail, created_at) values (${crypto.randomUUID()}, ${row.contact_id}, ${row.lead_id}, 'note', 'Customer feedback received', ${rating + "/5 — " + feedback}, ${now})`;
      let workflow = null;
      if (row.lead_id) {
        const lead = (await sql`select status from leads where id = ${row.lead_id} limit 1`)[0] as any;
        workflow = await fireTrigger(sql as any, "review_completed", String(row.lead_id), String(lead?.status ?? ""));
        await processDue(sql as any);
      }
      return json({ ok: true, workflow });
    }

    return json({ ok: false, error: "Unknown review action." }, 400);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Reviews API error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Reviews request failed" }, 500);
  }
};

export const config: Config = { path: "/api/reviews" };
