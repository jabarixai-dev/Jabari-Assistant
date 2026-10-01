import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";
import { fireTrigger, processDue } from "./workflow-engine.mts";

const AUTH_URL =
  "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL =
  "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const OWNER_EMAIL = "jabari.tech.org@gmail.com";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function requireOwner(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const verified = await jwtVerify(header.slice(7).trim(), jwks, { issuer: AUTH_URL });
  const email = typeof verified.payload.email === "string"
    ? verified.payload.email.toLowerCase()
    : "";
  if (email !== OWNER_EMAIL) {
    throw new Response(JSON.stringify({ error: "Owner access required" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
}

function database() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

const STATUSES = ["scheduled", "confirmed", "completed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

function validStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export default async (request: Request) => {
  try {
    await requireOwner(request);
    const sql = database();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (request.method === "GET") {
      const from = Number(url.searchParams.get("from") ?? 0);
      const to = Number(url.searchParams.get("to") ?? Date.now() + 7 * 86400000);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        return json({ ok: false, error: "Invalid from/to range" }, 400);
      }

      const rows = await sql`
        select a.*,
          l.name as lead_name,
          c.name as contact_name,
          c.email as contact_email,
          c.company as contact_company
        from appointments a
        left join leads l on l.id = a.lead_id
        left join contacts c on c.id = a.contact_id
        where a.start_at >= ${from} and a.start_at < ${to}
        order by a.start_at asc
        limit 200
      `;
      return json({ ok: true, appointments: rows });
    }

    if (request.method === "POST") {
      const input = await request.json() as Record<string, unknown>;
      const title = String(input.title ?? "").trim();
      const description = String(input.description ?? "").trim();
      const startAt = Number(input.startAt);
      const endAt = Number(input.endAt);
      const location = String(input.location ?? "").trim();
      const meetingUrl = input.meetingUrl ? String(input.meetingUrl).trim() : null;
      const contactId = input.contactId ? String(input.contactId) : null;
      const leadId = input.leadId ? String(input.leadId) : null;

      if (!title) return json({ ok: false, error: "Title is required" }, 400);
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
        return json({ ok: false, error: "End time must be after start time" }, 400);
      }

      const overlap = await sql`
        select id from appointments
        where status <> 'cancelled'
          and start_at < ${endAt}
          and end_at > ${startAt}
        limit 1
      `;
      if (overlap[0]) {
        return json({ ok: false, error: "That time overlaps another appointment." }, 409);
      }

      const now = Date.now();
      const appointmentId = crypto.randomUUID();
      const rows = await sql`
        insert into appointments (
          id, contact_id, lead_id, title, description, start_at, end_at,
          status, location, meeting_url, created_at, updated_at
        )
        values (
          ${appointmentId}, ${contactId}, ${leadId}, ${title}, ${description},
          ${startAt}, ${endAt}, 'scheduled', ${location}, ${meetingUrl},
          ${now}, ${now}
        )
        returning *
      `;

      if (contactId) {
        await sql`
          insert into crm_activities (
            id, contact_id, lead_id, type, title, detail, created_at
          )
          values (
            ${crypto.randomUUID()}, ${contactId}, ${leadId}, 'appointment',
            'Appointment scheduled',
            ${title + " · " + new Date(startAt).toLocaleString()},
            ${now}
          )
        `;
      }

      if (leadId) {
        await fireTrigger(sql, "appointment_booked", leadId).catch((e) =>
          console.error("Workflow trigger error", e),
        );
        await processDue(sql).catch((e) => console.error("Workflow process error", e));
      }

      return json({ ok: true, appointment: rows[0] }, 201);
    }

    if (request.method === "PATCH") {
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const input = await request.json() as Record<string, unknown>;
      if (!validStatus(input.status)) {
        return json({ ok: false, error: "status must be scheduled, confirmed, completed, or cancelled" }, 400);
      }

      const existing = await sql`select * from appointments where id = ${id} limit 1`;
      const appointment = existing[0];
      if (!appointment) return json({ ok: false, error: "Appointment not found" }, 404);
      if (appointment.status === input.status) return json({ ok: true, appointment });

      const now = Date.now();
      const rows = await sql`
        update appointments
        set status = ${input.status}, updated_at = ${now}
        where id = ${id}
        returning *
      `;

      if (appointment.contact_id) {
        await sql`
          insert into crm_activities (
            id, contact_id, lead_id, type, title, detail, created_at
          )
          values (
            ${crypto.randomUUID()},
            ${appointment.contact_id},
            ${appointment.lead_id},
            'appointment',
            ${"Appointment " + String(input.status)},
            ${String(appointment.title)},
            ${now}
          )
        `;
      }

      return json({ ok: true, appointment: rows[0] });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Appointments API error", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Appointments request failed",
    }, 500);
  }
};

export const config: Config = { path: "/api/appointments" };
