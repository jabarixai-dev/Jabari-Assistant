import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { generateText } from "ai";
import { neon } from "@neondatabase/serverless";
import { createMacalyLanguageModel } from "./lib/macaly-model";

const AUTH_URL="https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";
const JWKS_URL="https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";
const OWNER_EMAIL="jabari.tech.org@gmail.com";
const jwks=createRemoteJWKSet(new URL(JWKS_URL));
const json=(b:Record<string,unknown>,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json"}});
async function auth(req:Request){const h=req.headers.get("authorization");if(!h?.startsWith("Bearer "))throw new Response(JSON.stringify({error:"Authentication required"}),{status:401});const v=await jwtVerify(h.slice(7).trim(),jwks,{issuer:AUTH_URL});if(String(v.payload.email||"").toLowerCase()!==OWNER_EMAIL)throw new Response(JSON.stringify({error:"Owner access required"}),{status:403});}
function db(){const u=Netlify.env.get("DATABASE_URL");if(!u)throw new Error("DATABASE_URL is not configured.");return neon(u)}
function email(v:string){return v.trim().toLowerCase().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||null}
function phone(v:string,loc:string){let d=v.replace(/[^0-9]/g,"");if(d.startsWith("00"))d=d.slice(2);if(d.startsWith("0")&&/nigeria/i.test(loc))d="234"+d.slice(1);return d.length>=8&&d.length<=15?d:null}
async function search(q:string){const key=Netlify.env.get("SERPAPI_KEY");if(!key)throw new Error("SERPAPI_KEY is not configured.");const p=new URLSearchParams({engine:"google",q,api_key:key,output:"json",num:"10"});const r=await fetch("https://serpapi.com/search.json?"+p,{headers:{Accept:"application/json"}});if(!r.ok)throw new Error("SerpApi search failed ("+r.status+").");const d=await r.json() as any;return(Array.isArray(d.organic_results)?d.organic_results:[]).map((x:any)=>({title:String(x.title||""),url:String(x.link||""),snippet:String(x.snippet||"")})).filter((x:any)=>x.url)}
function obj(t:string){try{return JSON.parse(t.trim().replace(/^\`json\s*/i,"").replace(/\`\s*$/,""))}catch{const a=t.indexOf("{"),b=t.lastIndexOf("}");try{return a>=0&&b>a?JSON.parse(t.slice(a,b+1)):{} }catch{return{}}}}
export default async(req:Request)=>{
 try{
  await auth(req);if(req.method!=="POST")return json({error:"Method not allowed"},405);
  const x=await req.json() as {action?:string;prospectId?:string};if(!x.prospectId)return json({error:"prospectId is required"},400);
  const sql=db();const rows=await sql.query("SELECT * FROM prospects WHERE id=$1 LIMIT 1",[x.prospectId]);const p=rows[0];if(!p)return json({error:"Prospect not found"},404);const now=Date.now();
  if((x.action||"analyze")==="analyze"){
   await sql.query("UPDATE prospects SET analysis_status='pending',updated_at=$1 WHERE id=$2",[now,p.id]);
   try{
    const extra=await search('"'+p.name+'" "'+p.url+'" contact email owner founder about');const base=Netlify.env.get("MACALY_BASE_URL"),token=Netlify.env.get("MACALY_API_TOKEN"),chat=Netlify.env.get("MACALY_CHAT_ID");if(!base||!token||!chat)throw new Error("AI environment is not configured.");
    const r=await generateText({model:createMacalyLanguageModel({baseUrl:base,apiToken:token,chatId:chat,bypassHeader:Netlify.env.get("MACALY_BYPASS_HEADER"),preset:"FAST"}),system:"Use only supplied prospect and search evidence. Return JSON keys email, phone, contact, fit, pain, subject, body. Never invent facts or infer contact details.",prompt:JSON.stringify({prospect:p,additionalSearch:extra})});
    const o=obj(r.text),em=email(String(o.email||"")),ph=phone(String(o.phone||""),String(p.target_location||"")),cn=String(o.contact||"").trim(),fit=String(o.fit||p.qualification_reason||"").trim(),pain=String(o.pain||"Specific website opportunity needs manual review.").trim(),subject=String(o.subject||"Website opportunity for "+p.name).trim(),body=String(o.body||"Hello,\n\nI came across "+p.name+" while researching your space. I had a few ideas that may strengthen your online presence. If useful, I would be happy to share them.\n\nBest,\nJabari Tech").trim();
    await sql.query("UPDATE prospects SET contact_email=$1,contact_phone=$2,contact_name=$3,fit_reason=$4,pain_point=$5,outreach_subject=$6,outreach_body=$7,analysis_status='ready',updated_at=$8 WHERE id=$9",[em,ph,cn||null,fit,pain,subject,body,now,p.id]);await sql.query("INSERT INTO outreach_events (kind,prospect_id,metadata,created_at) VALUES ('prospect_analyzed',$1,$2,$3)",[p.id,JSON.stringify({hasEmail:Boolean(em),hasPhone:Boolean(ph)}),now]);return json({success:true,hasEmail:Boolean(em),hasPhone:Boolean(ph)});
   }catch(e){await sql.query("UPDATE prospects SET analysis_status='failed',updated_at=$1 WHERE id=$2",[Date.now(),p.id]);throw e}
  }
  if(x.action==="enrich"){
   if(p.contact_email||p.contact_phone){await sql.query("UPDATE prospects SET contact_status='verified',contact_checked_at=$1,updated_at=$1 WHERE id=$2",[now,p.id]);return json({status:"verified",email:p.contact_email||null,phone:p.contact_phone||null})}
   const qs=['"'+p.name+'" "'+p.url+'" email phone','"'+p.name+'" "'+p.url+'" founder owner email phone','"'+p.url+'" contact phone','"'+p.name+'" "contact us" email phone'];const results=(await Promise.all(qs.map(search))).flat();const base=Netlify.env.get("MACALY_BASE_URL"),token=Netlify.env.get("MACALY_API_TOKEN"),chat=Netlify.env.get("MACALY_CHAT_ID");if(!base||!token||!chat)throw new Error("AI environment is not configured.");
   const r=await generateText({model:createMacalyLanguageModel({baseUrl:base,apiToken:token,chatId:chat,bypassHeader:Netlify.env.get("MACALY_BYPASS_HEADER"),preset:"FAST"}),system:"Extract only publicly displayed contact details. Return exactly EMAIL:, PHONE:, CONTACT:, SOURCE:, EVIDENCE:. Never infer.",prompt:JSON.stringify({prospect:p,results})});
   const pick=(l:string)=>r.text.match(new RegExp("^\\s*"+l+":\\s*(.*?)(?=\\n(?:EMAIL|CONTACT|SOURCE|EVIDENCE):|$)","is"))?.[1]?.trim()||"";const em=email(pick("EMAIL")),ph=phone(pick("PHONE"),String(p.target_location||"")),cn=pick("CONTACT"),src=pick("SOURCE"),ev=pick("EVIDENCE"),status=(em||ph)&&src&&ev?"verified":(em||ph||cn||src||ev)?"needs_review":"no_contact";
   await sql.query("UPDATE prospects SET contact_email=$1,contact_phone=$2,contact_name=$3,contact_source=$4,contact_evidence=$5,contact_status=$6,contact_checked_at=$7,updated_at=$7 WHERE id=$8",[em,ph,cn||null,src||null,ev||null,status,now,p.id]);await sql.query("INSERT INTO outreach_events (kind,prospect_id,metadata,created_at) VALUES ($1,$2,$3,$4)",[status==="verified"?"contact_verified":status==="no_contact"?"contact_not_found":"contact_review_needed",p.id,JSON.stringify({hasEmail:Boolean(em),hasPhone:Boolean(ph),source:src||null}),now]);return json({status,email:em,phone:ph});
  }
  if(x.action==="convert"){
   const em=String(p.contact_email||"").trim().toLowerCase(),ph=String(p.contact_phone||"").trim();if(!em&&!ph)throw new Error("Verify a public email or phone before adding this prospect to CRM.");
   let c:any=(await sql.query("SELECT * FROM contacts WHERE lower(email)=$1 LIMIT 1",[em]))[0];if(!c&&ph)c=(await sql.query("SELECT * FROM contacts WHERE phone=$1 LIMIT 1",[ph]))[0];
   if(c){await sql.query("UPDATE contacts SET name=$1,phone=$2,email=$3,company=$4,website=$5,updated_at=$6 WHERE id=$7",[p.contact_name||c.name,ph||c.phone,em||c.email,c.company||p.name,c.website||p.url,now,c.id]);await sql.query("INSERT INTO crm_activities (id,contact_id,type,title,detail,created_at) VALUES ($1,$2,'note','Prospect linked to CRM',$3,$4)",[crypto.randomUUID(),c.id,"Converted from prospect research: "+p.name,now]);return json({contactId:c.id,created:false})}
   const id=crypto.randomUUID();await sql.query("INSERT INTO contacts (id,name,email,company,phone,website,source,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'prospect_research',$7,$7)",[id,p.contact_name||p.name,em||"unknown@local.invalid",p.name,ph||null,p.url,now]);await sql.query("INSERT INTO crm_activities (id,contact_id,type,title,detail,created_at) VALUES ($1,$2,'note','Prospect added to CRM',$3,$4)",[crypto.randomUUID(),id,"Added from prospect research: "+p.name,now]);return json({contactId:id,created:true});
  }
  return json({error:"Unsupported action"},400);
 }catch(e){if(e instanceof Response)return e;return json({error:e instanceof Error?e.message:"Prospect operation failed."},500)}
};
export const config:Config={path:"/api/prospect-research"};