import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const AUTH_URL =
  "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL =
  "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function requireAuth(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return jwtVerify(token, jwks, {
    issuer: AUTH_URL,
  });
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
    const resource = url.searchParams.get("resource") ?? "contacts";
    const id = url.searchParams.get("id");

    if (request.method === "GET" && resource === "analytics-dashboard") {
      const [leadRows, prospectRows, leadDraftRows, prospectDraftRows, taskRows, contactRows, activityRows, opportunityRows] = await Promise.all([
        sql`select status, count(*)::integer as count from leads group by status`,
        sql`select qualification_status, status, contact_status, website_status, count(*)::integer as count from prospects group by qualification_status, status, contact_status, website_status`,
        sql`select status, count(*)::integer as count from outreach_drafts group by status`,
        sql`select status, delivery_status, count(*)::integer as count from prospect_outreach_drafts group by status, delivery_status`,
        sql`select status, count(*)::integer as count from workflow_tasks group by status`,
        sql`select count(*)::integer as count from contacts`,
        sql`select count(*)::integer as count from crm_activities`,
        sql`select stage, coalesce(sum(value),0)::numeric as value, coalesce(sum(value * probability / 100),0)::numeric as weighted_value, count(*)::integer as count from opportunities group by stage`,
      ]);
      const statuses = ["new","contacted","qualified","won","lost"] as const;
      const byStatus = Object.fromEntries(statuses.map((status) => [status, Number(leadRows.find((r) => r.status === status)?.count ?? 0)]));
      const countWhere = (rows: Array<Record<string, unknown>>, key: string, value: string) => rows.filter((r) => r[key] === value).reduce((sum, r) => sum + Number(r.count ?? 0), 0);
      const prospectCount = prospectRows.reduce((sum, r) => sum + Number(r.count ?? 0), 0);
      const opportunities = opportunityRows.map((r) => ({
        stage: String(r.stage),
        value: Number(r.value ?? 0),
        weightedValue: Number(r.weighted_value ?? 0),
        count: Number(r.count ?? 0),
      }));
      return json({
        ok: true,
        leads: { total: Object.values(byStatus).reduce((a,b) => a + b, 0), byStatus },
        prospects: {
          total: prospectCount,
          qualified: countWhere(prospectRows, "qualification_status", "qualified"),
          review: countWhere(prospectRows, "qualification_status", "review"),
          rejected: countWhere(prospectRows, "qualification_status", "rejected"),
          saved: countWhere(prospectRows, "status", "saved"),
          analyzed: countWhere(prospectRows, "analysis_status", "ready"),
          ready: prospectRows.filter((r) => r.contact_status === "verified").reduce((sum, r) => sum + Number(r.count ?? 0), 0),
          noWebsite: countWhere(prospectRows, "website_status", "no_website"),
        },
        outreach: {
          drafts: countWhere(leadDraftRows, "status", "draft") + countWhere(prospectDraftRows, "status", "draft"),
          approved: countWhere(leadDraftRows, "status", "approved") + countWhere(prospectDraftRows, "status", "approved"),
          sent: countWhere(leadDraftRows, "status", "sent") + countWhere(prospectDraftRows, "status", "sent"),
          undeliverable: prospectDraftRows.filter((r) => r.delivery_status === "undeliverable").reduce((sum, r) => sum + Number(r.count ?? 0), 0),
        },
        workflowTasks: {
          open: countWhere(taskRows, "status", "open"),
          done: countWhere(taskRows, "status", "done"),
        },
        contacts: Number(contactRows[0]?.count ?? 0),
        activities: Number(activityRows[0]?.count ?? 0),
        opportunities: {
          total: opportunities.reduce((sum, r) => sum + r.count, 0),
          openValue: opportunities.filter((r) => !["won","lost"].includes(r.stage)).reduce((sum, r) => sum + r.value, 0),
          weightedValue: opportunities.filter((r) => !["won","lost"].includes(r.stage)).reduce((sum, r) => sum + r.weightedValue, 0),
          wonRevenue: opportunities.filter((r) => r.stage === "won").reduce((sum, r) => sum + r.value, 0),
        },
      });
    }

    if (request.method === "GET" && resource === "analytics-funnel") {
      const [sources, forms, bookings] = await Promise.all([
        sql`select coalesce(nullif(source,''),'unknown') as source, count(*)::integer as count from contacts group by 1 order by count desc limit 30`,
        sql`select lf.id, lf.name, lf.status, count(fs.id)::integer as submissions from lead_forms lf left join form_submissions fs on fs.form_id=lf.id group by lf.id order by submissions desc limit 30`,
        sql`select bt.id, bt.name, bt.status, count(b.id)::integer as bookings from booking_types bt left join bookings b on b.booking_type_id=bt.id group by bt.id order by bookings desc limit 30`
      ]);
      return json({ok:true,sources:sources.map(r=>({source:String(r.source),count:Number(r.count)})),forms:forms.map(r=>({id:String(r.id),name:String(r.name),status:String(r.status),submissions:Number(r.submissions)})),bookings:bookings.map(r=>({id:String(r.id),name:String(r.name),status:String(r.status),bookings:Number(r.bookings)}))});
    }

    if (request.method === "GET" && resource === "analytics-revenue") {
      const now = Date.now();
      const startAt = Number(url.searchParams.get("startAt") ?? 0);
      const endAt = Number(url.searchParams.get("endAt") ?? now);
      const opportunities = await sql`select stage, value, probability, expected_close_at, created_at, updated_at from opportunities`;
      const inPeriod = (timestamp: unknown) => typeof timestamp === "number" && timestamp >= startAt && timestamp < endAt;
      const open = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
      const openWithCloseDate = open.filter((o) => inPeriod(Number(o.expected_close_at)));
      const openPipelineValue = open.reduce((sum, o) => sum + Number(o.value), 0);
      const forecastedRevenue = openWithCloseDate.reduce((sum, o) => sum + Number(o.value) * (Number(o.probability) / 100), 0);
      const expectedCloseValue = openWithCloseDate.reduce((sum, o) => sum + Number(o.value), 0);
      const expectedCloses = openWithCloseDate.length;
      const won = opportunities.filter((o) => o.stage === "won" && inPeriod(Number(o.updated_at)));
      const lost = opportunities.filter((o) => o.stage === "lost" && inPeriod(Number(o.updated_at)));
      const wonRevenue = won.reduce((sum, o) => sum + Number(o.value), 0);
      const lostValue = lost.reduce((sum, o) => sum + Number(o.value), 0);
      const closedCount = won.length + lost.length;
      const conversionRate = closedCount ? (won.length / closedCount) * 100 : 0;
      const averageDealValue = closedCount ? (wonRevenue + lostValue) / closedCount : 0;
      const newDeals = opportunities.filter((o) => inPeriod(Number(o.created_at))).length;
      const undatedOpenValue = open.filter((o) => o.expected_close_at == null).reduce((sum, o) => sum + Number(o.value), 0);
      const stages = ["new","contacted","qualified","proposal","negotiation","won","lost"].map((stage) => {
        const rows = opportunities.filter((o) => o.stage === stage);
        const periodRows = stage === "won" || stage === "lost" ? rows.filter((o) => inPeriod(Number(o.updated_at))) : rows.filter((o) => inPeriod(Number(o.expected_close_at)));
        return {
          stage,
          count: periodRows.length,
          value: periodRows.reduce((sum, o) => sum + Number(o.value), 0),
          weightedValue: periodRows.reduce((sum, o) => sum + Number(o.value) * (Number(o.probability) / 100), 0),
        };
      });
      return json({ ok: true, startAt, endAt, openPipelineValue, forecastedRevenue, expectedCloseValue, expectedCloses, wonRevenue, wonDeals: won.length, lostDeals: lost.length, conversionRate, averageDealValue, newDeals, undatedOpenValue, stages });
    }

    if (request.method === "GET" && resource === "contacts") {
      const search = url.searchParams.get("search")?.trim() ?? "";
      const rows = search
        ? await sql`
            select c.*,
              coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', a.id,
                    'type', a.type,
                    'title', a.title,
                    'detail', a.detail,
                    'created_at', a.created_at
                  ) order by a.created_at desc
                ) filter (where a.id is not null),
                '[]'::jsonb
              ) as activities
            from contacts c
            left join crm_activities a on a.contact_id = c.id
            where c.name ilike ${"%" + search + "%"}
               or c.email ilike ${"%" + search + "%"}
               or c.company ilike ${"%" + search + "%"}
            group by c.id
            order by c.updated_at desc
            limit 200
          `
        : await sql`
            select c.*,
              coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', a.id,
                    'type', a.type,
                    'title', a.title,
                    'detail', a.detail,
                    'created_at', a.created_at
                  ) order by a.created_at desc
                ) filter (where a.id is not null),
                '[]'::jsonb
              ) as activities
            from contacts c
            left join crm_activities a on a.contact_id = c.id
            group by c.id
            order by c.updated_at desc
            limit 200
          `;

      return json({ ok: true, contacts: rows });
    }

    if (request.method === "GET" && resource === "contact") {
      if (!id) return json({ ok: false, error: "id is required" }, 400);

      const rows = await sql`
        select c.*,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', a.id,
                'type', a.type,
                'title', a.title,
                'detail', a.detail,
                'created_at', a.created_at
              ) order by a.created_at desc
            ) filter (where a.id is not null),
            '[]'::jsonb
          ) as activities
        from contacts c
        left join crm_activities a on a.contact_id = c.id
        where c.id = ${id}
        group by c.id
        limit 1
      `;

      if (!rows[0]) return json({ ok: false, error: "Contact not found" }, 404);
      return json({ ok: true, contact: rows[0] });
    }

    if (request.method === "GET" && resource === "companies") {
      const search = url.searchParams.get("search")?.trim() ?? "";
      const rows = search
        ? await sql`
            select co.*,
              count(c.id)::integer as contact_count
            from companies co
            left join contacts c on c.company_id = co.id
            where co.name ilike ${"%" + search + "%"}
               or co.industry ilike ${"%" + search + "%"}
            group by co.id
            order by co.updated_at desc
            limit 200
          `
        : await sql`
            select co.*,
              count(c.id)::integer as contact_count
            from companies co
            left join contacts c on c.company_id = co.id
            group by co.id
            order by co.updated_at desc
            limit 200
          `;

      return json({ ok: true, companies: rows });
    }

    if (request.method === "GET" && resource === "company") {
      if (!id) return json({ ok: false, error: "id is required" }, 400);

      const rows = await sql`
        select co.*,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'name', c.name,
                'email', c.email,
                'phone', c.phone,
                'job_title', c.job_title
              ) order by c.updated_at desc
            ) filter (where c.id is not null),
            '[]'::jsonb
          ) as contacts
        from companies co
        left join contacts c on c.company_id = co.id
        where co.id = ${id}
        group by co.id
        limit 1
      `;

      if (!rows[0]) return json({ ok: false, error: "Company not found" }, 404);
      return json({ ok: true, company: rows[0] });
    }

    if (request.method === "POST" && resource === "contact") {
      const input = (await request.json()) as JsonRecord;
      const name = String(input.name ?? "").trim();
      const email = String(input.email ?? "").trim().toLowerCase();
      const company = String(input.company ?? "").trim();

      if (!name || !email || !company) {
        return json({ ok: false, error: "name, email and company are required" }, 400);
      }

      const now = Date.now();
      const contactId = crypto.randomUUID();
      const rows = await sql`
        insert into contacts (
          id, name, email, company, phone, source, lead_id, company_id,
          job_title, website, notes, tags, created_at, updated_at
        )
        values (
          ${contactId},
          ${name},
          ${email},
          ${company},
          ${input.phone ? String(input.phone).trim() : null},
          ${input.source ? String(input.source).trim() : "manual"},
          ${input.leadId ? String(input.leadId) : null},
          ${input.companyId ? String(input.companyId) : null},
          ${input.jobTitle ? String(input.jobTitle).trim() : null},
          ${input.website ? String(input.website).trim() : null},
          ${input.notes ? String(input.notes).trim() : null},
          ${input.tags === undefined ? null : JSON.stringify(input.tags)},
          ${now},
          ${now}
        )
        returning *
      `;

      return json({ ok: true, contact: rows[0] }, 201);
    }

    if (request.method === "POST" && resource === "company") {
      const input = (await request.json()) as JsonRecord;
      const name = String(input.name ?? "").trim();

      if (!name) return json({ ok: false, error: "name is required" }, 400);

      const now = Date.now();
      const companyId = crypto.randomUUID();
      const rows = await sql`
        insert into companies (
          id, name, website, industry, notes, created_at, updated_at
        )
        values (
          ${companyId},
          ${name},
          ${input.website ? String(input.website).trim() : null},
          ${input.industry ? String(input.industry).trim() : null},
          ${input.notes ? String(input.notes).trim() : null},
          ${now},
          ${now}
        )
        returning *
      `;

      return json({ ok: true, company: rows[0] }, 201);
    }

    return json({ ok: false, error: "Unsupported CRM operation" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;

    console.error("CRM API error", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "CRM request failed",
      },
      500,
    );
  }
};

export const config: Config = {
  path: "/api/crm",
};
