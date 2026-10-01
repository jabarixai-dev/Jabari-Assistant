import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
async function auth(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  return jwtVerify(header.slice(7), jwks, { issuer: AUTH_URL });
}
function db() {
  const url = Netlify.env.get("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}
const value = (input: Record<string, unknown>, key: string) =>
  input[key] === undefined || input[key] === null ? null : String(input[key]).trim();

export default async (request: Request) => {
  try {
    await auth(request);
    const sql = db();
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const id = url.searchParams.get("id");

    if (request.method === "PUT" && action === "contact") {
      if (!id) return response({ error: "id is required" }, 400);
      const input = await request.json() as Record<string, unknown>;
      const name = value(input, "name") || "";
      const email = (value(input, "email") || "").toLowerCase();
      const company = value(input, "company") || "";
      if (!name || !email || !company) return response({ error: "name, email and company are required" }, 400);
      const rows = await sql`
        update contacts set name = ${name}, email = ${email}, company = ${company},
          phone = ${value(input, "phone")}, job_title = ${value(input, "jobTitle")},
          website = ${value(input, "website")}, notes = ${value(input, "notes")},
          tags = ${input.tags === undefined ? null : JSON.stringify(input.tags)}, updated_at = ${Date.now()}
        where id = ${id} returning *
      `;
      if (!rows[0]) return response({ error: "Contact not found" }, 404);
      return response({ ok: true, contact: rows[0] });
    }

    if (request.method === "POST" && action === "contact-note") {
      if (!id) return response({ error: "id is required" }, 400);
      const input = await request.json() as Record<string, unknown>;
      const detail = value(input, "detail") || "";
      if (!detail) return response({ error: "detail is required" }, 400);
      const contact = await sql`select lead_id from contacts where id = ${id} limit 1`;
      if (!contact[0]) return response({ error: "Contact not found" }, 404);
      const rows = await sql`
        insert into crm_activities (id, contact_id, lead_id, type, title, detail, created_at)
        values (${crypto.randomUUID()}, ${id}, ${contact[0].lead_id}, 'note', 'Note added', ${detail}, ${Date.now()})
        returning *
      `;
      return response({ ok: true, activity: rows[0] }, 201);
    }

    if (request.method === "POST" && action === "contacts-import") {
      const input = await request.json() as Record<string, unknown>;
      const contacts = Array.isArray(input.contacts) ? input.contacts : [];
      if (contacts.length > 500) return response({ error: "Maximum 500 contacts per import" }, 400);
      let created = 0, updated = 0, skipped = 0;
      for (const raw of contacts) {
        if (!raw || typeof raw !== "object") { skipped++; continue; }
        const row = raw as Record<string, unknown>;
        const name = value(row, "name") || "";
        const email = (value(row, "email") || "").toLowerCase();
        const company = value(row, "company") || "";
        if (!name || !email || !company) { skipped++; continue; }
        const existing = await sql`select id from contacts where lower(email) = ${email} limit 1`;
        const now = Date.now();
        if (existing[0]) {
          await sql`
            update contacts set name = ${name}, company = ${company}, phone = ${value(row, "phone")},
              job_title = ${value(row, "jobTitle")}, website = ${value(row, "website")},
              notes = ${value(row, "notes")}, tags = ${row.tags === undefined ? null : JSON.stringify(row.tags)},
              updated_at = ${now} where id = ${existing[0].id}
          `;
          updated++;
        } else {
          await sql`
            insert into contacts (id, name, email, company, phone, source, job_title, website, notes, tags, created_at, updated_at)
            values (${crypto.randomUUID()}, ${name}, ${email}, ${company}, ${value(row, "phone")},
              'csv_import', ${value(row, "jobTitle")}, ${value(row, "website")}, ${value(row, "notes")},
              ${row.tags === undefined ? null : JSON.stringify(row.tags)}, ${now}, ${now})
          `;
          created++;
        }
      }
      return response({ ok: true, created, updated, skipped });
    }

    if (request.method === "PUT" && action === "company") {
      if (!id) return response({ error: "id is required" }, 400);
      const input = await request.json() as Record<string, unknown>;
      const rows = await sql`
        update companies set website = ${value(input, "website")}, industry = ${value(input, "industry")},
          notes = ${value(input, "notes")}, updated_at = ${Date.now()}
        where id = ${id} returning *
      `;
      if (!rows[0]) return response({ error: "Company not found" }, 404);
      return response({ ok: true, company: rows[0] });
    }

    if (request.method === "POST" && action === "companies-sync") {
      const contacts = await sql`
        select id, company from contacts
        where company is not null and trim(company) <> ''
        order by updated_at desc limit 500
      `;
      const unique = new Map<string, string>();
      for (const contact of contacts) {
        const name = String(contact.company || "").trim();
        if (name) unique.set(name.toLowerCase(), name);
      }
      let linked = 0;
      for (const name of unique.values()) {
        const companies = await sql`select id from companies where lower(name) = lower(${name}) limit 1`;
        let companyId: string;
        if (companies[0]) companyId = companies[0].id;
        else {
          companyId = crypto.randomUUID();
          await sql`insert into companies (id, name, created_at, updated_at) values (${companyId}, ${name}, ${Date.now()}, ${Date.now()})`;
        }
        const result = await sql`
          update contacts set company_id = ${companyId}, updated_at = ${Date.now()}
          where lower(trim(company)) = lower(${name}) and (company_id is distinct from ${companyId})
        `;
        linked += Number(result.count ?? 0);
      }
      return response({ ok: true, companies: unique.size, linked });
    }

    return response({ error: "Unsupported CRM action" }, 405);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("CRM actions error", error);
    return response({ error: error instanceof Error ? error.message : "CRM action failed" }, 500);
  }
};
export const config: Config = { path: "/api/crm-actions" };
