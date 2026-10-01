import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

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

type Person = { id: string; name: string; company: string | null; email: string | null } | null;

type FeedEvent = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  createdAt: number;
  lead: Person;
  contact: Person;
  prospect: Person;
};

const person = (row: Record<string, unknown> | null | undefined): Person =>
  row
    ? {
        id: String(row.id),
        name: String(row.name ?? "Unknown"),
        company: row.company != null ? String(row.company) : null,
        email: row.email != null ? String(row.email) : null,
      }
    : null;

export default async (request: Request) => {
  try {
    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
    await requireOwner(request);
    const sql = db();

    const activities = await sql`
      select a.id, a.type, a.title, a.detail, a.created_at,
        to_jsonb(l) as lead, to_jsonb(c) as contact
      from crm_activities a
      left join leads l on l.id = a.lead_id
      left join contacts c on c.id = a.contact_id
      order by a.created_at desc limit 150
    `;

    const outreach = await sql`
      select e.id, e.kind, e.metadata, e.created_at,
        to_jsonb(l) as lead, to_jsonb(p) as prospect
      from outreach_events e
      left join leads l on l.id = e.lead_id
      left join prospects p on p.id = e.prospect_id
      order by e.created_at desc limit 150
    `;

    const appointments = await sql`
      select a.id, a.title, a.status, a.start_at, a.updated_at,
        to_jsonb(l) as lead, to_jsonb(c) as contact
      from appointments a
      left join leads l on l.id = a.lead_id
      left join contacts c on c.id = a.contact_id
      order by a.updated_at desc limit 150
    `;

    const tasks = await sql`
      select t.id, t.title, t.detail, t.status, t.updated_at,
        to_jsonb(l) as lead
      from workflow_tasks t
      left join leads l on l.id = t.lead_id
      order by t.updated_at desc limit 150
    `;

    const events: FeedEvent[] = [];

    for (const a of activities) {
      const t = String(a.type);
      const kind = t === "appointment" ? "appointment" : t === "workflow" ? "workflow" : t === "email_sent" ? "email" : "lead";
      events.push({
        id: "crm:" + a.id,
        kind,
        title: String(a.title),
        detail: String(a.detail ?? ""),
        createdAt: Number(a.created_at),
        lead: person(a.lead),
        contact: person(a.contact),
        prospect: null,
      });
    }

    for (const e of outreach) {
      const meta = e.metadata && typeof e.metadata === "object" ? e.metadata as Record<string, unknown> : {};
      const detail = typeof meta.error === "string" ? meta.error : "Outreach activity";
      events.push({
        id: "outreach:" + e.id,
        kind: "email",
        title: String(e.kind).replace(/_/g, " "),
        detail,
        createdAt: Number(e.created_at),
        lead: person(e.lead),
        contact: null,
        prospect: person(e.prospect),
      });
    }

    for (const a of appointments) {
      events.push({
        id: "appointment:" + a.id,
        kind: "appointment",
        title: String(a.title),
        detail: String(a.status) + " · " + new Date(Number(a.start_at)).toLocaleString(),
        createdAt: Number(a.updated_at),
        lead: person(a.lead),
        contact: person(a.contact),
        prospect: null,
      });
    }

    for (const t of tasks) {
      events.push({
        id: "task:" + t.id,
        kind: "workflow",
        title: String(t.title),
        detail: String(t.detail) + " · " + String(t.status),
        createdAt: Number(t.updated_at),
        lead: person(t.lead),
        contact: null,
        prospect: null,
      });
    }

    events.sort((a, b) => b.createdAt - a.createdAt);

    return json({ ok: true, events: events.slice(0, 150) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Activity feed API error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Activity feed request failed" }, 500);
  }
};

export const config: Config = { path: "/api/activity-feed" };
