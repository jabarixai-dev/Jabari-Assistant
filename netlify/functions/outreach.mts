import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { generateText } from "ai";
import { neon } from "@neondatabase/serverless";
import { createMacalyLanguageModel } from "./lib/macaly-model";
import { buildBrandedEmailHtml } from "./lib/email-brand";

const AUTH_URL="https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL="https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const OWNER_EMAIL="jabari.tech.org@gmail.com";
const jwks=createRemoteJWKSet(new URL(JWKS_URL));
const out=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
async function auth(req:Request){const h=req.headers.get("authorization");if(!h?.startsWith("Bearer "))throw out({error:"Authentication required"},401);const v=await jwtVerify(h.slice(7),jwks,{issuer:AUTH_URL});if(String(v.payload.email||"").toLowerCase()!==OWNER_EMAIL)throw out({error:"Owner access required"},403)}
const clean=(v:unknown)=>String(v??"").trim();
async function sendGmail(to:string,subject:string,bodyText:string){
 const base=Netlify.env.get("MACALY_BASE_URL"),token=Netlify.env.get("MACALY_API_TOKEN"),chatId=Netlify.env.get("MACALY_CHAT_ID");
 if(!base||!token||!chatId)throw new Error("Macaly email gateway is not configured.");
 const r=await fetch(base.replace(/\/$/,"")+"/api/client-app/composio-execute",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({chatId,action:"execute",toolName:"GMAIL_SEND_EMAIL",appName:"GMAIL",params:{user_id:"me",recipient_email:to,from_email:OWNER_EMAIL,subject:subject.trim(),body:buildBrandedEmailHtml({subject,bodyText}),body_text:bodyText.trim(),is_html:true}})});
 const data=await r.json() as any;if(!r.ok||data?.result?.successful===false)throw new Error(String(data?.result?.error||"Gmail rejected the send request."));
}
export default async(req:Request)=>{
 try{
  await auth(req); const u=new URL(req.url), action=u.searchParams.get("action")||"list", id=u.searchParams.get("id"); const sql=neon(Netlify.env.get("DATABASE_URL")||"");
  if(req.method==="GET"&&action==="list"){if(!id)return out({error:"id is required"},400);const rows=await sql`select * from outreach_drafts where lead_id=${id} order by updated_at desc limit 10`;return out({ok:true,drafts:rows})}
  if(req.method==="POST"&&action==="create"){if(!id)return out({error:"lead id is required"},400);const leads=await sql`select * from leads where id=${id} limit 1`;const lead=leads[0];if(!lead||!String(lead.email).includes("@"))return out({error:"Lead has no valid email"},400);const now=Date.now(),draftId=crypto.randomUUID();await sql`insert into outreach_drafts(id,lead_id,subject,body_text,status,created_at,updated_at) values(${draftId},${id},${"Drafting your Jabari Tech enquiry follow-up…"},${"The AI is preparing a personalized draft. You can review it before anything is sent."},'draft',${now},${now})`;await sql`insert into outreach_events(id,kind,lead_id,metadata,created_at) values(${crypto.randomUUID()},'draft_created',${id},${JSON.stringify({channel:"inbound"})},${now})`;
   const activities=await sql`select title,detail from crm_activities where lead_id=${id} order by created_at desc limit 20`;const msgs=lead.thread_id?await sql`select role,message from chat_messages where thread_id=${lead.thread_id} order by "order" asc limit 100`:[];const base=Netlify.env.get("MACALY_BASE_URL"),token=Netlify.env.get("MACALY_API_TOKEN"),chatId=Netlify.env.get("MACALY_CHAT_ID");if(base&&token&&chatId){const ai=await generateText({model:createMacalyLanguageModel({baseUrl:base,apiToken:token,chatId,bypassHeader:Netlify.env.get("MACALY_BYPASS_HEADER"),preset:"CODE"}),system:"Write concise, professional, low-pressure outreach for Jabari Tech. Use only supplied lead details. Do not invent facts, clients, prices, results, guarantees, or prior conversations. Return exactly SUBJECT: and BODY: sections.",prompt:JSON.stringify({lead,activities,messages})});const t=ai.text.trim(),sm=t.match(/^SUBJECT:\s*(.+?)(?:\n|$)/i),bm=t.match(/BODY:\s*([\s\S]*)$/i);await sql`update outreach_drafts set subject=${sm?.[1]?.trim()||"Following up on your Jabari Tech enquiry"},body_text=${bm?.[1]?.trim()||t},updated_at=${Date.now()} where id=${draftId}`;}
   const rows=await sql`select * from outreach_drafts where id=${draftId}`;return out({ok:true,draft:rows[0]});
  }
  if(req.method==="PUT"&&action==="update"){if(!id)return out({error:"draft id is required"},400);const x=await req.json() as any;const rows=await sql`update outreach_drafts set subject=${clean(x.subject)},body_text=${clean(x.bodyText)},status='draft',updated_at=${Date.now()} where id=${id} and status not in ('sent','cancelled') returning *`;if(!rows[0])return out({error:"Draft cannot be edited"},400);return out({ok:true,draft:rows[0]})}
  if(req.method==="POST"&&action==="approve"){if(!id)return out({error:"draft id is required"},400);const now=Date.now();const rows=await sql`update outreach_drafts set status='approved',updated_at=${now} where id=${id} and status='draft' returning *`;if(!rows[0])return out({error:"Only draft outreach can be approved"},400);await sql`insert into outreach_events(id,kind,lead_id,metadata,created_at) values(${crypto.randomUUID()},'draft_approved',${rows[0].lead_id},${JSON.stringify({draftId:id})},${now})`;return out({ok:true,draft:rows[0]})}
  if(req.method==="POST"&&action==="send"){if(!id)return out({error:"draft id is required"},400);const rows=await sql`select d.*,l.email from outreach_drafts d join leads l on l.id=d.lead_id where d.id=${id} limit 1`;const d=rows[0];if(!d||d.status!=="approved")return out({error:"Only approved drafts can be sent"},400);await sendGmail(String(d.email),String(d.subject),String(d.body_text));const now=Date.now();const sent=await sql`update outreach_drafts set status='sent',sent_at=${now},updated_at=${now} where id=${id} and status='approved' returning *`;await sql`insert into outreach_events(id,kind,lead_id,metadata,created_at) values(${crypto.randomUUID()},'email_sent',${d.lead_id},${JSON.stringify({draftId:id,channel:"gmail"})},${now})`;await sql`insert into crm_activities(id,lead_id,type,title,detail,created_at) values(${crypto.randomUUID()},${d.lead_id},'email_sent','Outreach email sent',${d.subject},${now})`;return out({ok:true,draft:sent[0]})}
  return out({error:"Unsupported outreach operation"},405);
 }catch(e){if(e instanceof Response)return e;console.error("Outreach API",e);return out({error:e instanceof Error?e.message:"Outreach request failed"},500)}
};
export const config:Config={path:"/api/outreach"};