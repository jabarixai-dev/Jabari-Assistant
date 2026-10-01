import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

export const config: Config = { path: "/api/campaigns" };

const AUTH = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS = createRemoteJWKSet(new URL(AUTH + "/.well-known/jwks.json"));
const OWNER = "jabari.tech.org@gmail.com";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function requireOwner(req: Request) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new Error("Authentication required.");
  const { payload } = await jwtVerify(header.slice(7), JWKS, { issuer: AUTH });
  if (String(payload.email || "").toLowerCase() !== OWNER) throw new Error("Owner access required.");
}
function sql() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return neon(url);
}
const stepTypes = new Set(["email", "create_task", "add_note", "update_stage"]);
const statuses = new Set(["draft", "active", "paused"]);

export default async function handler(req: Request) {
  try {
    await requireOwner(req);
    const db = sql();
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";

    if (action === "list") {
      const campaigns = await db`SELECT id,name,description,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM campaigns ORDER BY updated_at DESC LIMIT 50`;
      for (const campaign of campaigns as any[]) {
        campaign.steps = await db`SELECT id,"order",type,delay_minutes AS "delayMinutes",subject,body FROM campaign_steps WHERE campaign_id=${campaign.id} ORDER BY "order"`;
        const count = await db`SELECT count(*)::int AS count FROM campaign_enrollments WHERE campaign_id=${campaign.id} AND status='active'`;
        campaign.activeEnrollments = Number((count as any[])[0]?.count || 0);
      }
      return json({ campaigns });
    }

    if (action === "leads") {
      const campaignId = url.searchParams.get("campaignId");
      if (!campaignId) return json({ error: "campaignId is required." }, 400);
      const leads = await db`SELECT id,name,email,status,updated_at AS "updatedAt" FROM leads ORDER BY updated_at DESC LIMIT 100`;
      const enrolled = await db`SELECT lead_id FROM campaign_enrollments WHERE campaign_id=${campaignId}`;
      const ids = new Set((enrolled as any[]).map(row => row.lead_id));
      return json({ leads: (leads as any[]).map(lead => ({ ...lead, enrolled: ids.has(lead.id) })) });
    }

    const body = req.method === "POST" ? await req.json() : {};

    if (action === "create") {
      const steps = Array.isArray(body.steps) ? body.steps : [];
      if (!String(body.name || "").trim() || steps.length === 0) return json({ error: "Campaign name and at least one step are required." }, 400);
      for (const step of steps) {
        if (!stepTypes.has(String(step.type)) || Number(step.delayMinutes) < 0) return json({ error: "Invalid campaign step." }, 400);
        if (step.type === "email" && !String(step.subject || "").trim()) return json({ error: "Email steps need a subject." }, 400);
      }
      const now = Date.now(), id = crypto.randomUUID();
      await db`INSERT INTO campaigns(id,name,description,status,created_at,updated_at) VALUES(${id},${String(body.name).trim()},${String(body.description || "").trim()},'draft',${now},${now})`;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await db`INSERT INTO campaign_steps(id,campaign_id,"order",type,delay_minutes,subject,body,created_at) VALUES(${crypto.randomUUID()},${id},${i},${String(step.type)},${Number(step.delayMinutes) || 0},${step.subject ? String(step.subject).trim() : null},${String(step.body || "").trim()},${now})`;
      }
      return json({ id });
    }

    if (action === "status") {
      const status = String(body.status || "");
      if (!statuses.has(status)) return json({ error: "Invalid campaign status." }, 400);
      await db`UPDATE campaigns SET status=${status},updated_at=${Date.now()} WHERE id=${String(body.campaignId)}`;
      return json({ ok: true });
    }

    if (action === "enroll") {
      const campaignId = String(body.campaignId), leadId = String(body.leadId);
      const campaign = (await db`SELECT * FROM campaigns WHERE id=${campaignId}` as any[])[0];
      const lead = (await db`SELECT * FROM leads WHERE id=${leadId}` as any[])[0];
      if (!campaign || !lead) return json({ error: "Campaign or lead not found." }, 404);
      if (campaign.status !== "active") return json({ error: "Activate the campaign before enrolling a lead." }, 400);
      const existing = (await db`SELECT * FROM campaign_enrollments WHERE campaign_id=${campaignId} AND lead_id=${leadId} LIMIT 1` as any[])[0];
      if (existing?.status === "active") return json({ id: existing.id });
      const first = (await db`SELECT * FROM campaign_steps WHERE campaign_id=${campaignId} ORDER BY "order" LIMIT 1` as any[])[0];
      if (!first) return json({ error: "Campaign has no steps." }, 400);
      const now = Date.now(), nextRunAt = now + Number(first.delay_minutes) * 60000, enrollmentId = existing?.id || crypto.randomUUID();
      if (existing) await db`UPDATE campaign_enrollments SET status='active',current_step=0,next_run_at=${nextRunAt},stopped_at=NULL,completed_at=NULL WHERE id=${enrollmentId}`;
      else await db`INSERT INTO campaign_enrollments(id,campaign_id,lead_id,status,current_step,next_run_at,enrolled_at) VALUES(${enrollmentId},${campaignId},${leadId},'active',0,${nextRunAt},${now})`;
      await db`INSERT INTO campaign_events(id,campaign_id,enrollment_id,lead_id,step_index,type,detail,created_at) VALUES(${crypto.randomUUID()},${campaignId},${enrollmentId},${leadId},0,'enrolled','Lead enrolled in campaign.',${now})`;
      await db`INSERT INTO campaign_events(id,campaign_id,enrollment_id,lead_id,step_index,type,detail,created_at) VALUES(${crypto.randomUUID()},${campaignId},${enrollmentId},${leadId},0,'step_scheduled','First step scheduled.',${now})`;
      return json({ id: enrollmentId, scheduledAt: nextRunAt });
    }

    if (action === "stop") {
      await db`UPDATE campaign_enrollments SET status='stopped',stopped_at=${Date.now()},next_run_at=NULL WHERE id=${String(body.enrollmentId)} AND status='active'`;
      return json({ ok: true });
    }

    if (action === "events") {
      const events = await db`SELECT * FROM campaign_events WHERE campaign_id=${String(url.searchParams.get("campaignId"))} ORDER BY created_at DESC LIMIT 40`;
      return json({ events });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Request failed." }, 500);
  }
}
