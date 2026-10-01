import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const OWNER_EMAIL = "jabari.tech.org@gmail.com";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
async function requireOwner(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  const verified = await jwtVerify(header.slice(7).trim(), jwks, { issuer: AUTH_URL });
  const email = typeof verified.payload.email === "string" ? verified.payload.email.toLowerCase() : "";
  if (email !== OWNER_EMAIL) throw new Response(JSON.stringify({ error: "Owner access required" }), { status: 403 });
}
function db() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}
const triggers = ["lead_created","stage_changed","appointment_booked","invoice_paid","form_submitted","review_completed"] as const;
const stages = ["any","new","contacted","qualified","won","lost"] as const;
const actionTypes = ["create_task","add_note","create_email_draft","update_stage","branch","goal"] as const;
function validOne<T extends readonly string[]>(value: unknown, list: T): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export default async (request: Request) => {
  try {
    await requireOwner(request);
    const sql = db();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (request.method === "GET") {
      const rows = await sql`
        select id, name, trigger, condition, action, action_value, steps, goal, enabled, created_at, updated_at
        from workflows
        order by updated_at desc
        limit 100
      `;
      return json({ ok: true, workflows: rows });
    }

    if (request.method === "POST") {
      const input = await request.json() as Record<string, unknown>;
      const name = String(input.name ?? "").trim();
      const trigger = input.trigger;
      const condition = input.condition;
      const action = input.action;
      const actionValue = String(input.actionValue ?? "").trim();
      const goal = input.goal ? String(input.goal).trim() : null;
      const steps = Array.isArray(input.steps) ? input.steps : [];

      if (!name || !validOne(trigger, triggers) || !validOne(condition, stages) || !validOne(action, ["create_task","add_note","create_email_draft"] as const)) {
        return json({ ok: false, error: "Invalid workflow name, trigger, condition, or action" }, 400);
      }
      if (!actionValue) return json({ ok: false, error: "Action value is required" }, 400);
      for (const step of steps) {
        if (!step || typeof step !== "object" || !validOne((step as any).type, actionTypes) || typeof (step as any).value !== "string") {
          return json({ ok: false, error: "Invalid workflow step" }, 400);
        }
        if ((step as any).delayMinutes != null && (!Number.isFinite(Number((step as any).delayMinutes)) || Number((step as any).delayMinutes) < 0)) {
          return json({ ok: false, error: "Delay cannot be negative" }, 400);
        }
      }

      const now = Date.now();
      const workflowId = crypto.randomUUID();
      const normalizedSteps = steps.length ? steps.map((s: any) => ({ ...s, delayMinutes: Number(s.delayMinutes || 0) })) : [{ type: action, value: actionValue, delayMinutes: 0 }];
      const rows = await sql`
        insert into workflows (id,name,trigger,condition,action,action_value,steps,goal,enabled,created_at,updated_at)
        values (${workflowId},${name},${trigger},${condition},${action},${actionValue},${JSON.stringify(normalizedSteps)},${goal},true,${now},${now})
        returning *
      `;
      return json({ ok: true, workflow: rows[0] }, 201);
    }

    if (request.method === "PATCH") {
      if (!id) return json({ ok: false, error: "id is required" }, 400);
      const input = await request.json() as Record<string, unknown>;
      if (typeof input.enabled !== "boolean") return json({ ok: false, error: "enabled must be boolean" }, 400);
      const rows = await sql`update workflows set enabled=${input.enabled}, updated_at=${Date.now()} where id=${id} returning *`;
      if (!rows[0]) return json({ ok: false, error: "Workflow not found" }, 404);
      return json({ ok: true, workflow: rows[0] });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Workflows API error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Workflow request failed" }, 500);
  }
};

export const config: Config = { path: "/api/workflows" };
