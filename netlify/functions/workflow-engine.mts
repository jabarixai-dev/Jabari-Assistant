import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

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

function db() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url) as NeonQueryFunction<Record<string, unknown>, unknown[]>;
}

type Sql = ReturnType<typeof db>;
type LeadRow = {
  id: string;
  name: string;
  email: string;
  company: string;
  budget: string;
  timeline: string;
  status: string;
};
type WorkflowRow = {
  id: string;
  name: string;
  trigger: string;
  condition: string;
  action: string;
  action_value: string;
  steps: Step[] | null;
  goal: string | null;
};
type Step = {
  type: string;
  value: string;
  delayMinutes?: number;
  trueStep?: number;
  falseStep?: number;
};

const EVENTS = [
  "lead_created",
  "stage_changed",
  "appointment_booked",
  "invoice_paid",
  "form_submitted",
  "review_completed",
] as const;
type Event = (typeof EVENTS)[number];
const STAGES = ["new", "contacted", "qualified", "won", "lost"];

function isEvent(value: unknown): value is Event {
  return typeof value === "string" && (EVENTS as readonly string[]).includes(value);
}
function validStage(value: string) {
  return STAGES.includes(value);
}

// Expression format: "field|op|target" e.g. "status|equals|qualified", "company|contains|tech"
function matches(expr: string, status: string, lead: LeadRow | null): boolean {
  if (!expr || expr === "any") return true;
  const [field, op, raw] = expr.split("|");
  const target = (raw ?? "").trim().toLowerCase();
  const actual = field === "status"
    ? status
    : field === "company"
    ? String(lead?.company ?? "")
    : field === "budget"
    ? String(lead?.budget ?? "")
    : field === "timeline"
    ? String(lead?.timeline ?? "")
    : "";
  const a = actual.toLowerCase();
  if (op === "equals") return a === target;
  if (op === "contains") return a.includes(target);
  if (op === "not_equals") return a !== target;
  return false;
}

function stepsOf(flow: WorkflowRow): Step[] {
  const stored = Array.isArray(flow.steps) ? flow.steps : [];
  return stored.length
    ? stored
    : [{ type: flow.action, value: flow.action_value, delayMinutes: 0 }];
}

async function findContactId(sql: Sql, email: string): Promise<string | null> {
  const rows = await sql`select id from contacts where lower(email) = lower(${email}) order by updated_at desc limit 1`;
  return (rows[0]?.id as string | undefined) ?? null;
}

async function addActivity(
  sql: Sql,
  lead: LeadRow,
  contactId: string | null,
  title: string,
  detail: string,
) {
  await sql`
    insert into crm_activities (id, contact_id, lead_id, type, title, detail, created_at)
    values (${crypto.randomUUID()}, ${contactId}, ${lead.id}, 'workflow', ${title}, ${detail}, ${Date.now()})
  `;
}

/** Fire an event: start matching enabled workflows for the lead (no duplicate active executions). */
export async function fireTrigger(
  sql: Sql,
  event: Event,
  leadId: string,
  status?: string,
): Promise<{ started: number; skipped: number }> {
  const leadRows = await sql`select * from leads where id = ${leadId} limit 1`;
  const lead = leadRows[0] as LeadRow | undefined;
  if (!lead) throw new Error("Lead not found");
  const currentStatus = status && validStage(status) ? status : lead.status;

  const flows = (await sql`
    select id, name, trigger, condition, action, action_value, steps, goal
    from workflows where enabled = true order by updated_at desc limit 100
  `) as WorkflowRow[];

  let started = 0;
  let skipped = 0;
  for (const flow of flows) {
    if (flow.trigger !== event) continue;
    if (flow.condition !== "any" && flow.condition !== currentStatus) continue;
    const existing = (await sql`
      select id from workflow_executions
      where workflow_id = ${flow.id} and lead_id = ${lead.id} and status = 'active'
      limit 1
    `)[0];
    if (existing) {
      skipped += 1;
      continue;
    }
    const now = Date.now();
    await sql`
      insert into workflow_executions (id, workflow_id, lead_id, current_step, status, started_at, updated_at)
      values (${crypto.randomUUID()}, ${flow.id}, ${lead.id}, 0, 'active', ${now}, ${now})
    `;
    started += 1;
  }
  return { started, skipped };
}

/** Advance one execution: run the current step, then schedule or complete. */
async function runExecution(sql: Sql, executionId: string): Promise<void> {
  const exRows = (await sql`select * from workflow_executions where id = ${executionId} limit 1`)[0] as
    | { id: string; workflow_id: string; lead_id: string; current_step: number; status: string }
    | undefined;
  if (!exRows || exRows.status !== "active") return;

  const flowRows = (await sql`select * from workflows where id = ${exRows.workflow_id} limit 1`)[0] as
    | WorkflowRow
    | undefined;
  const leadRows = (await sql`select * from leads where id = ${exRows.lead_id} limit 1`)[0] as
    | LeadRow
    | undefined;
  if (!flowRows || !leadRows) {
    await sql`
      update workflow_executions set status = 'failed', last_error = 'Workflow or lead not found.', updated_at = ${Date.now()}
      where id = ${exRows.id}
    `;
    return;
  }

  const steps = stepsOf(flowRows);
  let currentStep = exRows.current_step;

  // Guard against bad stored step indexes.
  if (currentStep >= steps.length) {
    const now = Date.now();
    await sql`
      update workflow_executions set status = 'completed', completed_at = ${now}, updated_at = ${now}
      where id = ${exRows.id}
    `;
    return;
  }

  const contactId = await findContactId(sql, leadRows.email);
  let guard = 0;

  while (guard++ < 50) {
    const leadFreshRows = (await sql`select * from leads where id = ${leadRows.id} limit 1`)[0] as
      | LeadRow
      | undefined;
    if (!leadFreshRows) return;
    const lead = leadFreshRows;
    const step = steps[currentStep];
    const now = Date.now();

    if (!step) {
      await sql`
        update workflow_executions set status = 'completed', completed_at = ${now}, updated_at = ${now}
        where id = ${exRows.id}
      `;
      return;
    }

    if (step.type === "goal") {
      if (matches(step.value, lead.status, lead)) {
        await sql`
          update workflow_executions set status = 'completed', completed_at = ${now}, updated_at = ${now}
          where id = ${exRows.id}
        `;
        return;
      }
    } else if (step.type === "branch") {
      const yes = matches(step.value, lead.status, lead);
      const next = Number(yes ? step.trueStep : step.falseStep);
      if (Number.isInteger(next) && next >= 0 && next < steps.length) {
        currentStep = next;
        await sql`update workflow_executions set current_step = ${next}, updated_at = ${now} where id = ${exRows.id}`;
        continue; // Branches do not apply delay (matches Convex runAfter(0)).
      }
      await sql`
        update workflow_executions set status = 'completed', completed_at = ${now}, updated_at = ${now}
        where id = ${exRows.id}
      `;
      return;
    } else {
      // Action steps.
      if (step.type === "create_task") {
        await sql`
          insert into workflow_tasks (id, lead_id, title, detail, status, created_at, updated_at)
          values (${crypto.randomUUID()}, ${lead.id}, ${flowRows.name}, ${step.value}, 'open', ${now}, ${now})
        `;
      } else if (step.type === "add_note") {
        await sql`
          insert into crm_activities (id, contact_id, lead_id, type, title, detail, created_at)
          values (${crypto.randomUUID()}, ${contactId}, ${lead.id}, 'workflow', ${flowRows.name}, ${step.value}, ${now})
        `;
      } else if (step.type === "create_email_draft") {
        // Draft only. Sending stays an explicit approved Gmail action.
        await sql`
          insert into outreach_drafts (id, lead_id, subject, body_text, status, created_at, updated_at)
          values (${crypto.randomUUID()}, ${lead.id}, ${flowRows.name}, ${step.value}, 'draft', ${now}, ${now})
        `;
      } else if (step.type === "update_stage" && validStage(step.value)) {
        await sql`update leads set status = ${step.value}, updated_at = ${now} where id = ${lead.id}`;
        await addActivity(sql, lead, contactId, "Workflow updated lead stage", step.value);
      }

      await addActivity(
        sql,
        lead,
        contactId,
        "Workflow step completed",
        `${flowRows.name} · ${step.type}`,
      );

      const currentStatus = step.type === "update_stage" ? step.value : lead.status;
      if (flowRows.goal && matches(flowRows.goal, currentStatus, { ...lead, status: currentStatus })) {
        await sql`
          update workflow_executions set status = 'completed', completed_at = ${now}, updated_at = ${now}
          where id = ${exRows.id}
        `;
        return;
      }
    }

    const nextIndex = currentStep + 1;
    if (nextIndex >= steps.length) {
      await sql`
        update workflow_executions set status = 'completed', completed_at = ${now}, updated_at = ${now}
        where id = ${exRows.id}
      `;
      return;
    }
    const next = steps[nextIndex];
    const delay = Math.max(0, Number(next?.delayMinutes ?? 0)) * 60000;
    await sql`
      update workflow_executions
      set current_step = ${nextIndex}, scheduled_at = ${now + delay}, updated_at = ${now}
      where id = ${exRows.id}
    `;
    if (delay > 0) return; // Due later; processed by the "process" action.
    currentStep = nextIndex;
  }

  await sql`
    update workflow_executions set status = 'failed', last_error = 'Step limit exceeded.', updated_at = ${Date.now()}
    where id = ${exRows.id}
  `;
}

/** Run all due executions. Called after triggers; the UI can also call it directly. */
export async function processDue(sql: Sql): Promise<number> {
  const due = (await sql`
    select id from workflow_executions
    where status = 'active' and (scheduled_at is null or scheduled_at <= ${Date.now()})
    order by scheduled_at asc nulls first
    limit 50
  `) as { id: string }[];
  for (const row of due) {
    try {
      await runExecution(sql, row.id);
    } catch (error) {
      await sql`
        update workflow_executions set status = 'failed', last_error = ${error instanceof Error ? error.message : "Execution failed"}, updated_at = ${Date.now()}
        where id = ${row.id}
      `;
    }
  }
  return due.length;
}

export default async (request: Request) => {
  try {
    await requireOwner(request);
    const sql = db();
    const url = new URL(request.url);

    if (request.method === "GET") {
      // Execution observability: recent executions with workflow and lead names.
      const executions = await sql`
        select e.id, e.workflow_id, e.lead_id, e.current_step, e.status, e.scheduled_at,
          e.started_at, e.completed_at, e.last_error, e.updated_at,
          w.name as workflow_name, l.name as lead_name, l.email as lead_email
        from workflow_executions e
        left join workflows w on w.id = e.workflow_id
        left join leads l on l.id = e.lead_id
        order by e.updated_at desc
        limit 100
      `;
      return json({ ok: true, executions });
    }

    if (request.method === "POST") {
      const input = await request.json() as Record<string, unknown>;
      const action = String(input.action ?? "trigger");

      if (action === "trigger") {
        const event = input.event;
        const leadId = String(input.leadId ?? "").trim();
        const status = typeof input.status === "string" ? input.status : undefined;
        if (!isEvent(event)) return json({ ok: false, error: "Invalid event" }, 400);
        if (!leadId) return json({ ok: false, error: "leadId is required" }, 400);
        const result = await fireTrigger(sql, event, leadId, status);
        const processed = await processDue(sql);
        return json({ ok: true, ...result, processed });
      }

      if (action === "process") {
        const processed = await processDue(sql);
        return json({ ok: true, processed });
      }

      return json({ ok: false, error: "Unknown action. Use trigger or process." }, 400);
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Workflow engine error", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Workflow engine request failed",
    }, 500);
  }
};

export const config: Config = { path: "/api/workflow-engine" };
