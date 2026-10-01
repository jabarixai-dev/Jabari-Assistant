import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function out(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default async (request: Request) => {
  try {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return out({ error: "Authentication required" }, 401);
    await jwtVerify(header.slice(7), jwks, { issuer: AUTH_URL });

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return out({ error: "id is required" }, 400);

    const url = Netlify.env.get("DATABASE_URL");
    if (!url) throw new Error("DATABASE_URL is not configured");
    const sql = neon(url);

    const contactRows = await sql`
      select c.*, co.name as company_name, co.website as company_website
      from contacts c left join companies co on co.id = c.company_id
      where c.id = ${id} limit 1
    `;
    if (!contactRows[0]) return out({ error: "Contact not found" }, 404);

    const leadId = contactRows[0].lead_id;
    const [activities, lead, opportunities, tasks, appointments, invoices, reviews, workflowExecutions, campaignEnrollments, campaignEvents, outreachEvents] = await Promise.all([
      sql`select * from crm_activities where contact_id = ${id} order by created_at desc limit 200`,
      leadId ? sql`select * from leads where id = ${leadId} limit 1` : Promise.resolve([]),
      sql`select * from opportunities where contact_id = ${id} order by updated_at desc`,
      leadId ? sql`select * from workflow_tasks where lead_id = ${leadId} order by updated_at desc` : Promise.resolve([]),
      sql`select * from appointments where contact_id = ${id} order by start_at desc`,
      sql`select * from invoices where contact_id = ${id} order by updated_at desc`,
      sql`select * from review_requests where contact_id = ${id} order by updated_at desc`,
      leadId ? sql`select we.*, w.name as workflow_name from workflow_executions we join workflows w on w.id=we.workflow_id where we.lead_id=${leadId} order by we.updated_at desc limit 50` : Promise.resolve([]),
      leadId ? sql`select ce.*, c.name as campaign_name from campaign_enrollments ce join campaigns c on c.id=ce.campaign_id where ce.lead_id=${leadId} order by ce.enrolled_at desc` : Promise.resolve([]),
      leadId ? sql`select ce.*, c.name as campaign_name from campaign_events ce join campaigns c on c.id=ce.campaign_id where ce.lead_id=${leadId} order by ce.created_at desc limit 100` : Promise.resolve([]),
      leadId ? sql`select * from outreach_events where lead_id=${leadId} order by created_at desc limit 100` : Promise.resolve([]),
    ]);

    const contact = contactRows[0];
    return out({
      ok: true,
      contact,
      company: contact.company_id ? { id: contact.company_id, name: contact.company_name, website: contact.company_website } : null,
      lead: lead[0] ?? null,
      opportunities,
      tasks,
      appointments,
      invoices,
      reviews,
      activities,
      journey: { workflowExecutions, campaignEnrollments, campaignEvents, outreachEvents },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("CRM detail error", error);
    return out({ error: error instanceof Error ? error.message : "CRM detail failed" }, 500);
  }
};

export const config: Config = { path: "/api/crm-detail" };
