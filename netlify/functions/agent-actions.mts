import type { Context, Config } from "@netlify/functions";
import { jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const OWNER_EMAIL = "jabari.tech.org@gmail.com";
const AUTH_JWKS = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const sql = () => neon(Netlify.env.get("DATABASE_URL")!);

type ActionType = "create_task" | "add_note" | "update_stage" | "create_email_draft";
const stages = new Set(["new","contacted","qualified","won","lost"]);

async function auth(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Unauthorized");
  const { payload } = await jwtVerify(token, new TextEncoder().encode(AUTH_JWKS));
  const email = String(payload.email ?? payload.sub ?? "");
  if (email !== OWNER_EMAIL) throw new Error("Forbidden");
  return email;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export default async (req: Request, _context: Context) => {
  try {
    await auth(req);
    const db = sql();
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";

    if (req.method === "GET" && action === "list") {
      const leadId = url.searchParams.get("leadId");
      const rows = leadId
        ? await db`select aa.*, l.name as lead_name, l.email as lead_email from agent_actions aa left join leads l on l.id=aa.lead_id where aa.lead_id=${leadId} order by aa.created_at desc limit 100`
        : await db`select aa.*, l.name as lead_name, l.email as lead_email from agent_actions aa left join leads l on l.id=aa.lead_id order by aa.created_at desc limit 100`;
      return json({ ok: true, actions: rows });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const id = body.id as string | undefined;

      if (action === "create") {
        const leadId = String(body.leadId || "");
        const type = body.type as ActionType;
        if (!leadId || !["create_task","add_note","update_stage","create_email_draft"].includes(type)) {
          return json({ error: "Invalid action" }, 400);
        }
        const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
        const rows = await db`insert into agent_actions (lead_id, action_type, payload, status, created_at, updated_at) values (${leadId}, ${type}, ${JSON.stringify(payload)}::jsonb, 'pending', extract(epoch from now())*1000, extract(epoch from now())*1000) returning *`;
        return json({ ok: true, action: rows[0] }, 201);
      }

      if (!id) return json({ error: "Action id required" }, 400);

      if (action === "approve" || action === "reject") {
        const status = action === "approve" ? "approved" : "rejected";
        const rows = await db`update agent_actions set status=${status}, updated_at=extract(epoch from now())*1000 where id=${id} and status='pending' returning *`;
        if (!rows[0]) return json({ error: "Action not found or already processed" }, 404);
        return json({ ok: true, action: rows[0] });
      }

      if (action === "execute") {
        const rows = await db`select * from agent_actions where id=${id} limit 1`;
        const aa = rows[0] as any;
        if (!aa) return json({ error: "Action not found" }, 404);
        if (aa.status !== "approved") return json({ error: "Action must be approved before execution" }, 409);
        if (aa.executed_at) return json({ ok: true, action: aa });

        const p = aa.payload || {};
        if (aa.action_type === "create_task") {
          await db`insert into workflow_tasks (lead_id, title, description, status, due_at, created_at, updated_at) values (${aa.lead_id}, ${String(p.title || "AI follow-up task")}, ${String(p.description || "")}, 'open', ${p.dueAt ? Number(p.dueAt) : null}, extract(epoch from now())*1000, extract(epoch from now())*1000)`;
        } else if (aa.action_type === "add_note") {
          await db`insert into crm_activities (lead_id, type, title, description, created_at) values (${aa.lead_id}, 'note', 'AI action note', ${String(p.note || "")}, extract(epoch from now())*1000)`;
        } else if (aa.action_type === "update_stage") {
          const stage = String(p.stage || "");
          if (!stages.has(stage)) return json({ error: "Invalid stage" }, 400);
          await db`update leads set status=${stage}, updated_at=extract(epoch from now())*1000 where id=${aa.lead_id}`;
          await db`insert into crm_activities (lead_id, type, title, description, created_at) values (${aa.lead_id}, 'stage_changed', 'AI updated lead stage', ${"Stage changed to " + stage}, extract(epoch from now())*1000)`;
        } else if (aa.action_type === "create_email_draft") {
          await db`insert into outreach_drafts (lead_id, subject, body, status, created_at, updated_at) values (${aa.lead_id}, ${String(p.subject || "")}, ${String(p.body || "")}, 'draft', extract(epoch from now())*1000, extract(epoch from now())*1000)`;
        }

        const done = await db`update agent_actions set status='executed', executed_at=extract(epoch from now())*1000, updated_at=extract(epoch from now())*1000 where id=${id} returning *`;
        return json({ ok: true, action: done[0] });
      }
    }

    return json({ error: "Unsupported request" }, 405);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return json({ error: message }, message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500);
  }
};

export const config: Config = { path: "/api/agent-actions" };
