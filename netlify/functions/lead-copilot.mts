import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { generateText } from "ai";
import { neon } from "@neondatabase/serverless";
import { createGeminiModel } from "./lib/ai";

const AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const OWNER_EMAIL = "jabari.tech.org@gmail.com";
const jwks = createRemoteJWKSet(new URL(JWKS_URL));
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function requireOwner(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  const verified = await jwtVerify(header.slice(7).trim(), jwks, { issuer: AUTH_URL });
  const email = typeof verified.payload.email === "string" ? verified.payload.email.toLowerCase() : "";
  if (email !== OWNER_EMAIL) throw new Response(JSON.stringify({ error: "Owner access required" }), { status: 403 });
}
function clean(value: unknown, fallback = "Not provided") {
  const text = String(value ?? "").trim();
  return text || fallback;
}
export default async (request: Request) => {
  try {
    await requireOwner(request);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const input = await request.json() as { leadId?: string; focus?: string };
    if (!input.leadId) return json({ error: "leadId is required" }, 400);
    const databaseUrl = Netlify.env.get("DATABASE_URL");
    if (!databaseUrl || !Netlify.env.get("GEMINI_API_KEY")) return json({ error: "AI/database environment is not configured" }, 503);
    const sql = neon(databaseUrl);
    const leads = await sql`select * from leads where id = ${input.leadId} limit 1`;
    const lead = leads[0];
    if (!lead) return json({ error: "Lead not found" }, 404);
    const activities = await sql`select title, detail from crm_activities where lead_id = ${input.leadId} order by created_at desc limit 20`;
    const messages = lead.thread_id
      ? await sql`select role, message from chat_messages where thread_id = ${lead.thread_id} order by "order" desc limit 30`
      : [];
    const activityText = activities.map((item) => `- ${clean(item.title)}: ${clean(item.detail)}`).join("\n");
    const conversation = messages.reverse().map((item) => `${item.role === "user" ? "Visitor" : "Assistant"}: ${clean(item.message, "")}`).filter(Boolean).join("\n");
    const result = await generateText({
      model: createGeminiModel((name) => Netlify.env.get(name)),
      temperature: 0.2,
      system: [
        "You are Jabari Tech's internal Lead Copilot.",
        "Analyze CRM lead information factually. Do not invent facts, prices, commitments, or customer intent.",
        "This is an internal sales workspace. Recommend actions, but never claim an action was executed.",
        "Return exactly four labeled sections: SUMMARY, QUALIFICATION, RECOMMENDATION, DRAFT.",
        "SUMMARY: 2-4 concise sentences about the lead and what they asked for.",
        "QUALIFICATION: state evidence for fit/readiness and explicitly identify missing information.",
        "RECOMMENDATION: give one practical next step and explain why.",
        "DRAFT: write a short human-sounding follow-up email. Do not add a subject line, links, buttons, guarantees, or invented details."
      ].join(" "),
      prompt: [
        `Lead name: ${clean(lead.name)}`, `Email: ${clean(lead.email)}`, `Company: ${clean(lead.company)}`,
        `Request: ${clean(lead.request)}`, `Budget: ${clean(lead.budget)}`, `Timeline: ${clean(lead.timeline)}`,
        `Current status: ${clean(lead.status)}`, `Owner focus: ${clean(input.focus, "General qualification and next action")}`,
        "", "Recent CRM activity:", activityText || "None", "", "Recent visitor conversation:", conversation || "None"
      ].join("\n"),
    });
    const text = result.text.trim();
    const section = (name: string, next?: string) => {
      const upper = text.toUpperCase(), start = upper.indexOf(name + ":");
      if (start < 0) return "";
      const contentStart = start + name.length + 1;
      const end = next ? upper.indexOf(next + ":", contentStart) : text.length;
      return text.slice(contentStart, end < 0 ? text.length : end).trim();
    };
    return json({
      summary: section("SUMMARY", "QUALIFICATION") || text,
      qualification: section("QUALIFICATION", "RECOMMENDATION") || "The model did not return a separate qualification section.",
      recommendation: section("RECOMMENDATION", "DRAFT") || "Review the lead manually before taking action.",
      draft: section("DRAFT") || ""
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Lead Copilot error", error);
    return json({ error: error instanceof Error ? error.message : "Copilot analysis failed." }, 500);
  }
};
export const config: Config = { path: "/api/lead-copilot" };