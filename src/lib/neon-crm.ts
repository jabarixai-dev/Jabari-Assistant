import { getNeonSql } from "./neon-db";

export type NeonCompany = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export type NeonContact = {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string | null;
  source: string;
  lead_id: string | null;
  company_id: string | null;
  job_title: string | null;
  website: string | null;
  notes: string | null;
  tags: unknown;
  created_at: number;
  updated_at: number;
};

export async function listCompanies() {
  const sql = getNeonSql();
  return sql`select * from companies order by updated_at desc`;
}

export async function getCompany(id: string) {
  const sql = getNeonSql();
  const rows = await sql`select * from companies where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function createCompany(input: {
  name: string;
  website?: string;
  industry?: string;
  notes?: string;
}) {
  const sql = getNeonSql();
  const now = Date.now();
  const id = crypto.randomUUID();
  const rows = await sql`
    insert into companies (id, name, website, industry, notes, created_at, updated_at)
    values (
      ${id},
      ${input.name.trim()},
      ${input.website?.trim() || null},
      ${input.industry?.trim() || null},
      ${input.notes?.trim() || null},
      ${now},
      ${now}
    )
    returning *
  `;
  return rows[0];
}

export async function listContacts() {
  const sql = getNeonSql();
  return sql`select * from contacts order by updated_at desc`;
}

export async function getContact(id: string) {
  const sql = getNeonSql();
  const rows = await sql`select * from contacts where id = ${id} limit 1`;
  return rows[0] ?? null;
}

export async function createContact(input: {
  name: string;
  email: string;
  company: string;
  phone?: string;
  source?: string;
  leadId?: string;
  companyId?: string;
  jobTitle?: string;
  website?: string;
  notes?: string;
  tags?: unknown;
}) {
  const sql = getNeonSql();
  const now = Date.now();
  const id = crypto.randomUUID();
  const rows = await sql`
    insert into contacts (
      id, name, email, company, phone, source, lead_id, company_id,
      job_title, website, notes, tags, created_at, updated_at
    )
    values (
      ${id},
      ${input.name.trim()},
      ${input.email.trim().toLowerCase()},
      ${input.company.trim()},
      ${input.phone?.trim() || null},
      ${input.source?.trim() || "manual"},
      ${input.leadId || null},
      ${input.companyId || null},
      ${input.jobTitle?.trim() || null},
      ${input.website?.trim() || null},
      ${input.notes?.trim() || null},
      ${input.tags === undefined ? null : JSON.stringify(input.tags)},
      ${now},
      ${now}
    )
    returning *
  `;
  return rows[0];
}
