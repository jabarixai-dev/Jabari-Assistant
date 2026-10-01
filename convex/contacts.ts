import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { mutation, query } from "./_generated/server"
const OWNER_EMAIL="jabari.xai@gmail.com"
async function owner(ctx:any){const id=await getAuthUserId(ctx);if(!id)throw new Error("Authentication required.");return id}
export const list=query({args:{search:v.optional(v.string())},returns:v.array(v.any()),handler:async(ctx,args)=>{
 await owner(ctx);const rows=await ctx.db.query("contacts").withIndex("by_updatedAt").order("desc").take(500);const q=args.search?.trim().toLowerCase()
 if(q)return rows.filter((r:any)=>[r.name,r.email,r.company,r.phone||"",r.jobTitle||"",r.website||"",r.notes||"",...(r.tags||[])].join(" ").toLowerCase().includes(q))
 return rows
}})
export const get=query({args:{contactId:v.id("contacts")},returns:v.any(),handler:async(ctx,args)=>{
 await owner(ctx);const c=await ctx.db.get(args.contactId);if(!c)return null;const company=c.companyId?await ctx.db.get(c.companyId):null
 const lead=c.leadId?await ctx.db.get(c.leadId):await ctx.db.query("leads").withIndex("by_status_and_updatedAt").order("desc").take(200).then(rows=>rows.find((x:any)=>x.email.toLowerCase()===c.email.toLowerCase())??null)
 const opportunities=await ctx.db.query("opportunities").withIndex("by_stage_and_updatedAt").order("desc").take(500).then(rows=>rows.filter((x:any)=>x.contactId===c._id || x.leadId===lead?._id))
 const tasks=lead?await ctx.db.query("workflowTasks").withIndex("by_leadId_and_createdAt",q=>q.eq("leadId",lead._id)).order("desc").take(50):[]
 const appointments=await ctx.db.query("appointments").withIndex("by_startAt").order("desc").take(200).then(rows=>rows.filter((x:any)=>x.contactId===c._id || x.leadId===lead?._id).slice(0,50))
 const invoices=await ctx.db.query("invoices").withIndex("by_status_and_updatedAt").order("desc").take(500).then(rows=>rows.filter((x:any)=>x.contactId===c._id || x.leadId===lead?._id || x.customerEmail.toLowerCase()===c.email.toLowerCase()).slice(0,50))
 const reviews=await ctx.db.query("reviewRequests").withIndex("by_contactId").take(50).then(rows=>rows.filter((x:any)=>x.contactId===c._id || x.leadId===lead?._id))
 return {contact:c,company,lead,opportunities,tasks,appointments,invoices,reviews}
}})
export const listActivities=query({args:{contactId:v.id("contacts")},returns:v.array(v.any()),handler:async(ctx,args)=>{
 await owner(ctx);const c=await ctx.db.get(args.contactId);if(!c)return []
 const lead=c.leadId?await ctx.db.get(c.leadId):await ctx.db.query("leads").withIndex("by_status_and_updatedAt").order("desc").take(200).then(rows=>rows.find((x:any)=>x.email.toLowerCase()===c.email.toLowerCase())??null)
 const crm=await ctx.db.query("crmActivities").withIndex("by_contactId_and_createdAt",q=>q.eq("contactId",c._id)).order("desc").take(100)
 const out=lead?await ctx.db.query("outreachEvents").withIndex("by_createdAt").order("desc").take(100).then(rows=>rows.filter((x:any)=>x.leadId===lead._id).map((x:any)=>({kind:"outreach",title:x.kind==="email_received"?"Reply received":x.kind==="email_sent"?"Email sent":x.kind.replaceAll("_"," "),detail:String(x.metadata?.subject||x.metadata?.preview||""),createdAt:x.createdAt,_id:String(x._id)}))):[]
 const tasks=lead?await ctx.db.query("workflowTasks").withIndex("by_leadId_and_createdAt",q=>q.eq("leadId",lead._id)).order("desc").take(50).then(rows=>rows.map((x:any)=>({kind:"task",title:x.status==="done"?"Task completed":"Task created",detail:x.title+" — "+x.detail,createdAt:x.updatedAt,_id:String(x._id)}))):[]
 const appointments=await ctx.db.query("appointments").withIndex("by_startAt").order("desc").take(200).then(rows=>rows.filter((x:any)=>x.contactId===c._id||x.leadId===lead?._id).slice(0,50).map((x:any)=>({kind:"appointment",title:"Appointment "+x.status,detail:x.title,createdAt:x.startAt,_id:String(x._id)})))
 const invoices=await ctx.db.query("invoices").withIndex("by_status_and_updatedAt").order("desc").take(200).then(rows=>rows.filter((x:any)=>x.contactId===c._id||x.leadId===lead?._id||x.customerEmail.toLowerCase()===c.email.toLowerCase()).slice(0,50).map((x:any)=>({kind:"billing",title:"Invoice "+x.status,detail:x.number+" · "+x.currency+" "+x.total,createdAt:x.updatedAt,_id:String(x._id)})))
 return [...crm,...out,...tasks,...appointments,...invoices].sort((a:any,b:any)=>b.createdAt-a.createdAt).slice(0,150)
}})
export const update=mutation({args:{contactId:v.id("contacts"),name:v.string(),email:v.string(),company:v.string(),phone:v.optional(v.string()),jobTitle:v.optional(v.string()),website:v.optional(v.string()),notes:v.optional(v.string()),tags:v.optional(v.array(v.string()))},returns:v.null(),handler:async(ctx,args)=>{
 await owner(ctx);const c=await ctx.db.get(args.contactId);if(!c)throw new Error("Contact not found.");const email=args.email.trim().toLowerCase();if(!email.includes("@"))throw new Error("Enter a valid email.")
 await ctx.db.patch(c._id,{name:args.name.trim(),email,company:args.company.trim(),phone:args.phone?.trim()||undefined,jobTitle:args.jobTitle?.trim()||undefined,website:args.website?.trim()||undefined,notes:args.notes?.trim()||undefined,tags:args.tags?.map(x=>x.trim()).filter(Boolean),updatedAt:Date.now()});return null
}})
export const importContacts=mutation({args:{contacts:v.array(v.object({name:v.string(),email:v.string(),company:v.string(),phone:v.optional(v.string()),jobTitle:v.optional(v.string()),website:v.optional(v.string()),notes:v.optional(v.string()),tags:v.optional(v.array(v.string()))}))},returns:v.object({created:v.number(),updated:v.number(),skipped:v.number()}),handler:async(ctx,args)=>{
 await owner(ctx);if(args.contacts.length>500)throw new Error("Import is limited to 500 contacts per batch.");let created=0,updated=0,skipped=0
 for(const row of args.contacts){const email=row.email.trim().toLowerCase(),name=row.name.trim();if(!name||!email.includes("@")){skipped++;continue}const now=Date.now();let companyId:any=undefined;const companyName=row.company.trim()
  if(companyName){let company=await ctx.db.query("companies").withIndex("by_name",q=>q.eq("name",companyName)).first();if(!company){const id=await ctx.db.insert("companies",{name:companyName,createdAt:now,updatedAt:now});company=await ctx.db.get(id)}companyId=company?._id}
  const existing=await ctx.db.query("contacts").withIndex("by_email",q=>q.eq("email",email)).first();const patch={name,email,company:companyName,phone:row.phone?.trim()||undefined,jobTitle:row.jobTitle?.trim()||undefined,website:row.website?.trim()||undefined,notes:row.notes?.trim()||undefined,tags:row.tags?.map(x=>x.trim()).filter(Boolean),companyId,updatedAt:now}
  if(existing){await ctx.db.patch(existing._id,patch);updated++}else{const contactId=await ctx.db.insert("contacts",{...patch,source:"csv_import",createdAt:now});await ctx.db.insert("crmActivities",{contactId,type:"note",title:"Contact imported",detail:"Imported from CSV",createdAt:now});created++}
 } return {created,updated,skipped}
}})
export const addNote=mutation({args:{contactId:v.id("contacts"),detail:v.string()},returns:v.null(),handler:async(ctx,args)=>{await owner(ctx);const c=await ctx.db.get(args.contactId);if(!c)throw new Error("Contact not found.");const detail=args.detail.trim();if(!detail)throw new Error("Note cannot be empty.");await ctx.db.insert("crmActivities",{contactId:c._id,type:"note",title:"Note added",detail,createdAt:Date.now()});return null}})
