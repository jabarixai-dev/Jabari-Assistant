import type { Context } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const OWNER_EMAIL = "jabari.tech.org@gmail.com";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

async function authorize(req: Request) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) throw new Error("Authentication required.");
  const { payload } = await jwtVerify(h.slice(7), jwks, { issuer: AUTH_URL });
  if (String(payload.email || "").toLowerCase() !== OWNER_EMAIL) throw new Error("Owner access required.");
}

export default async (req: Request, _context: Context) => {
  try {
    await authorize(req);
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (q.length < 2) return Response.json({ contacts: [], companies: [], leads: [], prospects: [] });
    const databaseUrl = Netlify.env.get("DATABASE_URL");
    if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
    const sql = neon(databaseUrl);
    const like = "%" + q.replaceAll("%","\\%").replaceAll("_","\\_") + "%";
    const [contacts, companies, leads, prospects] = await Promise.all([
      sql`SELECT id, name, email, company, phone, job_title AS "jobTitle" FROM contacts WHERE concat_ws(' ',name,email,company,phone,job_title,website) ILIKE ${like} ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8`,
      sql`SELECT id, name, website, industry FROM companies WHERE concat_ws(' ',name,website,industry,notes) ILIKE ${like} ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8`,
      sql`SELECT id, name, email, company, request, status FROM leads WHERE concat_ws(' ',name,email,company,request,status) ILIKE ${like} ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8`,
      sql`SELECT id, name, url, contact_email AS "contactEmail", contact_phone AS "contactPhone", target_niche AS "targetNiche" FROM prospects WHERE concat_ws(' ',name,url,contact_email,contact_phone,target_niche) ILIKE ${like} ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8`,
    ]);
    return Response.json({ contacts, companies, leads, prospects });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed.";
    return Response.json({ error: message }, { status: message.includes("Authentication") || message.includes("Owner") ? 401 : 500 });
  }
};
