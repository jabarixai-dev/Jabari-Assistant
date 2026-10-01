import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";

const AUTH_URL="https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS=createRemoteJWKSet(new URL(AUTH_URL+"/.well-known/jwks.json"));
const OWNER="jabari.tech.org@gmail.com";
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json"}});
function db(){const u=Netlify.env.get("DATABASE_URL");if(!u)throw new Error("DATABASE_URL is not configured.");return neon(u);}
async function owner(req:Request){const h=req.headers.get("authorization");if(!h?.startsWith("Bearer "))throw new Response(JSON.stringify({error:"Authentication required."}),{status:401});const {payload}=await jwtVerify(h.slice(7),JWKS,{issuer:AUTH_URL});if(String(payload.email||"").toLowerCase()!==OWNER)throw new Response(JSON.stringify({error:"Owner access required."}),{status:403});}
function slugify(v:string){return v.trim().toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-|-$/g,"");}
export default async function handler(req:Request){
 try{
  const url=new URL(req.url),action=url.searchParams.get("action")||"list",sql=db();
  if(action==="public"){const slug=slugify(url.searchParams.get("slug")||"");const rows=await sql`select id,name,slug,headline,subheadline,cta_text as "ctaText",theme,sections,form_id as "formId",booking_type_id as "bookingTypeId,status from landing_pages where slug=${slug} and status='published' limit 1`;return rows[0]?json({page:rows[0]}):json({error:"Page not found."},404);}
  await owner(req);
  if(action==="list"){const rows=await sql`select id,name,slug,headline,subheadline,cta_text as "ctaText",theme,sections,form_id as "formId",booking_type_id as "bookingTypeId",status,created_at as "createdAt",updated_at as "updatedAt" from landing_pages order by updated_at desc limit 50`;return json({pages:rows});}
  const body=await req.json();
  if(action==="create"){const name=String(body.name||"").trim(),slug=slugify(String(body.slug||name)),headline=String(body.headline||"").trim();if(!name||!headline||!slug)return json({error:"Name, headline and valid slug are required."},400);const exists=await sql`select id from landing_pages where slug=${slug} limit 1`;if(exists.length)return json({error:"That slug already exists."},409);const now=Date.now(),sections=Array.isArray(body.sections)?body.sections:[{type:"hero",heading:"Turn interest into action.",body:"A focused landing page for your offer."},{type:"features",heading:"Why work with us?",body:"Clear value, proof and a simple next step."},{type:"cta",heading:"Ready to get started?",body:"Choose a time or send an enquiry."}];const id=crypto.randomUUID();await sql`insert into landing_pages(id,name,slug,headline,subheadline,cta_text,theme,sections,status,created_at,updated_at) values(${id},${name},${slug},${headline},${String(body.subheadline||"Tell visitors what you offer and why it matters.")},${String(body.ctaText||"Get started")},${String(body.theme||"dark-gold")},${JSON.stringify(sections)}::jsonb,'draft',${now},${now})`;return json({id});}
  if(action==="status"){const id=String(body.pageId),status=String(body.status);if(!["draft","published","paused"].includes(status))return json({error:"Invalid status."},400);await sql`update landing_pages set status=${status},updated_at=${Date.now()} where id=${id}`;return json({ok:true});}
  if(action==="update"){const id=String(body.pageId);await sql`update landing_pages set headline=coalesce(${body.headline??null},headline),subheadline=coalesce(${body.subheadline??null},subheadline),cta_text=coalesce(${body.ctaText??null},cta_text),sections=coalesce(${body.sections?JSON.stringify(body.sections):null}::jsonb,sections),form_id=coalesce(${body.formId??null},form_id),booking_type_id=coalesce(${body.bookingTypeId??null},booking_type_id),updated_at=${Date.now()} where id=${id}`;return json({ok:true});}
  return json({error:"Unknown action."},400);
 }catch(e){if(e instanceof Response)return e;console.error(e);return json({error:e instanceof Error?e.message:"Request failed."},500);}
}
export const config:Config={path:"/api/landing-pages"};
