import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { internal } from "./_generated/api"
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { callMacalyJson } from "./macaly"
import { buildBrandedEmailHtml } from "./emailBrand"

const OWNER_EMAIL="jabari.xai@gmail.com"
async function requireOwner(ctx:QueryCtx|MutationCtx){
  const userId=await getAuthUserId(ctx)
  if(!userId) throw new Error("Authentication required.")
  const user=await ctx.db.get(userId)
  const identity=await ctx.auth.getUserIdentity();const identityEmail=String((identity as any)?.email??"").toLowerCase();if(identityEmail!==OWNER_EMAIL&&user?.email?.toLowerCase()!==OWNER_EMAIL) throw new Error("Owner access required.")
}

const stepValidator=v.object({
  type:v.union(v.literal("email"),v.literal("create_task"),v.literal("add_note"),v.literal("update_stage")),
  delayMinutes:v.number(),
  subject:v.optional(v.string()),
  body:v.string(),
})

export const list=query({args:{},returns:v.array(v.any()),handler:async(ctx)=>{
  await requireOwner(ctx)
  const campaigns=await ctx.db.query("campaigns").withIndex("by_updatedAt").order("desc").take(50)
  return await Promise.all(campaigns.map(async(c)=>{
    const steps=await ctx.db.query("campaignSteps").withIndex("by_campaign_and_order",q=>q.eq("campaignId",c._id)).order("asc").collect()
    const active=await ctx.db.query("campaignEnrollments").withIndex("by_campaign_and_status",q=>q.eq("campaignId",c._id).eq("status","active")).collect()
    return {...c,steps,activeEnrollments:active.length}
  }))
}})

export const leadsForEnrollment=query({args:{campaignId:v.id("campaigns")},returns:v.array(v.any()),handler:async(ctx,args)=>{
  await requireOwner(ctx)
  const leads=await ctx.db.query("leads").withIndex("by_status_and_updatedAt").order("desc").take(100)
  const enrollments=await ctx.db.query("campaignEnrollments").withIndex("by_campaign_and_status",q=>q.eq("campaignId",args.campaignId)).collect()
  const enrolled=new Set(enrollments.map(e=>String(e.leadId)))
  return leads.map(l=>({...l,enrolled:enrolled.has(String(l._id))}))
}})

export const create=mutation({args:{name:v.string(),description:v.string(),steps:v.array(stepValidator)},returns:v.id("campaigns"),handler:async(ctx,args)=>{
  await requireOwner(ctx)
  if(!args.name.trim()) throw new Error("Campaign name is required.")
  if(args.steps.length===0) throw new Error("Add at least one sequence step.")
  const now=Date.now()
  const campaignId=await ctx.db.insert("campaigns",{name:args.name.trim(),description:args.description.trim(),status:"draft",createdAt:now,updatedAt:now})
  for(let i=0;i<args.steps.length;i++){
    const s=args.steps[i]
    if(s.delayMinutes<0) throw new Error("Delay cannot be negative.")
    if(s.type==="email" && !s.subject?.trim()) throw new Error("Email steps need a subject.")
    await ctx.db.insert("campaignSteps",{campaignId,order:i,type:s.type,delayMinutes:s.delayMinutes,subject:s.subject?.trim(),body:s.body.trim(),createdAt:now})
  }
  return campaignId
}})

export const setStatus=mutation({args:{campaignId:v.id("campaigns"),status:v.union(v.literal("draft"),v.literal("active"),v.literal("paused"))},returns:v.null(),handler:async(ctx,args)=>{
  await requireOwner(ctx)
  const c=await ctx.db.get(args.campaignId); if(!c) throw new Error("Campaign not found.")
  await ctx.db.patch(c._id,{status:args.status,updatedAt:Date.now()})
  return null
}})

export const enroll=mutation({args:{campaignId:v.id("campaigns"),leadId:v.id("leads")},returns:v.id("campaignEnrollments"),handler:async(ctx,args)=>{
  await requireOwner(ctx)
  const c=await ctx.db.get(args.campaignId); const lead=await ctx.db.get(args.leadId)
  if(!c||!lead) throw new Error("Campaign or lead not found.")
  if(c.status!=="active") throw new Error("Activate the campaign before enrolling a lead.")
  const existing=await ctx.db.query("campaignEnrollments").withIndex("by_lead_and_campaign",q=>q.eq("leadId",lead._id).eq("campaignId",c._id)).first()
  if(existing?.status==="active") return existing._id
  const first=await ctx.db.query("campaignSteps").withIndex("by_campaign_and_order",q=>q.eq("campaignId",c._id)).order("asc").first()
  if(!first) throw new Error("Campaign has no steps.")
  const now=Date.now(), nextRunAt=now+first.delayMinutes*60*1000
  const enrollmentId=existing?existing._id:await ctx.db.insert("campaignEnrollments",{campaignId:c._id,leadId:lead._id,status:"active",currentStep:0,nextRunAt,enrolledAt:now})
  if(existing) await ctx.db.patch(existing._id,{status:"active",currentStep:0,nextRunAt,stoppedAt:undefined,completedAt:undefined})
  await ctx.db.insert("campaignEvents",{campaignId:c._id,enrollmentId,leadId:lead._id,stepIndex:0,type:"enrolled",detail:"Lead enrolled in campaign.",createdAt:now})
  await ctx.db.insert("campaignEvents",{campaignId:c._id,enrollmentId,leadId:lead._id,stepIndex:0,type:"step_scheduled",detail:"First step scheduled.",createdAt:now})
  await ctx.scheduler.runAt(nextRunAt,internal.campaigns.executeStep,{enrollmentId})
  return enrollmentId
}})

export const stopEnrollment=mutation({args:{enrollmentId:v.id("campaignEnrollments")},returns:v.null(),handler:async(ctx,args)=>{
  await requireOwner(ctx)
  const e=await ctx.db.get(args.enrollmentId); if(!e) throw new Error("Enrollment not found.")
  if(e.status!=="active") return null
  const now=Date.now()
  await ctx.db.patch(e._id,{status:"stopped",stoppedAt:now,nextRunAt:undefined})
  await ctx.db.insert("campaignEvents",{campaignId:e.campaignId,enrollmentId:e._id,leadId:e.leadId,stepIndex:e.currentStep,type:"stopped",detail:"Enrollment stopped by owner.",createdAt:now})
  return null
}})

export const recentEvents=query({args:{campaignId:v.id("campaigns")},returns:v.array(v.any()),handler:async(ctx,args)=>{
  await requireOwner(ctx)
  return await ctx.db.query("campaignEvents").withIndex("by_campaign_and_createdAt",q=>q.eq("campaignId",args.campaignId)).order("desc").take(40)
}})

export const getExecutionContext=internalQuery({args:{enrollmentId:v.id("campaignEnrollments")},returns:v.any(),handler:async(ctx,args)=>{
  const e=await ctx.db.get(args.enrollmentId); if(!e) return null
  const campaign=await ctx.db.get(e.campaignId); const lead=await ctx.db.get(e.leadId)
  const step=await ctx.db.query("campaignSteps").withIndex("by_campaign_and_order",q=>q.eq("campaignId",e.campaignId)).order("asc").collect().then(rows=>rows.find(s=>s.order===e.currentStep)??null)
  return e&&campaign&&lead&&step?{e,campaign,lead,step}:null
}})

function buildCampaignEmailHtml(bodyText:string){const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");const paragraphs=bodyText.trim().split(/\\n\\s*\\n/).map(p=>`<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#333;">${esc(p).replace(/\\n/g,"<br>")}</p>`).join("");return `<!doctype html><html><body style="margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#333;"><div style="max-width:640px;margin:24px auto;padding:0 20px;"><div style="padding-bottom:16px;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:600;color:#111;">Jabari Tech</div><div style="padding:24px 0;">${paragraphs}</div><div style="padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#777;">Jabari Tech · Website Builder & Content Writer</div></div></body></html>`}

async function sendEmail(toEmail:string,subject:string,bodyText:string){const plainText=bodyText.trim();const data=await callMacalyJson("/api/client-app/composio-execute",{action:"execute",toolName:"GMAIL_SEND_EMAIL",appName:"GMAIL",params:{user_id:"me",recipient_email:toEmail,from_email:OWNER_EMAIL,subject:subject.trim(),body:buildCampaignEmailHtml(plainText),body_text:plainText,is_html:true}});const result=(data.result??{}) as Record<string,unknown>;if(result._truncated)throw new Error("Gmail returned an unexpectedly large response.");if(result.successful===false)throw new Error(String(result.error??"Gmail rejected the send request."))}

export const executeStep=internalAction({args:{enrollmentId:v.id("campaignEnrollments")},returns:v.null(),handler:async(ctx,args)=>{
  const data=await ctx.runQuery(internal.campaigns.getExecutionContext,{enrollmentId:args.enrollmentId})
  if(!data||data.e.status!=="active"||data.campaign.status!=="active") return null
  const {e,campaign,lead,step}=data
  try{
    if(step.type==="email") await sendEmail(lead.email,step.subject??"Follow-up from Jabari Tech",step.body)
    if(step.type==="create_task") await ctx.runMutation(internal.campaigns.createTask,{enrollmentId:e._id,leadId:lead._id,title:step.body})
    if(step.type==="add_note") await ctx.runMutation(internal.campaigns.addNote,{enrollmentId:e._id,leadId:lead._id,body:step.body})
    if(step.type==="update_stage") await ctx.runMutation(internal.campaigns.updateStage,{enrollmentId:e._id,leadId:lead._id,stage:step.body})
    await ctx.runMutation(internal.campaigns.advance,{enrollmentId:e._id,campaignId:campaign._id,leadId:lead._id,stepIndex:step.order,type:step.type})
  }catch(error){
    await ctx.runMutation(internal.campaigns.markFailed,{enrollmentId:e._id,campaignId:campaign._id,leadId:lead._id,stepIndex:step.order,error:error instanceof Error?error.message:String(error)})
  }
  return null
}})

export const createTask=internalMutation({args:{enrollmentId:v.id("campaignEnrollments"),leadId:v.id("leads"),title:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  const now=Date.now(); await ctx.db.insert("workflowTasks",{leadId:args.leadId,title:args.title,detail:"Created by campaign sequence.",status:"open",createdAt:now,updatedAt:now})
  return null
}})
export const addNote=internalMutation({args:{enrollmentId:v.id("campaignEnrollments"),leadId:v.id("leads"),body:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  await ctx.db.insert("crmActivities",{leadId:args.leadId,type:"note",title:"Campaign note",detail:args.body,createdAt:Date.now()}); return null
}})
export const updateStage=internalMutation({args:{enrollmentId:v.id("campaignEnrollments"),leadId:v.id("leads"),stage:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  const allowed=["new","contacted","qualified","won","lost"] as const
  if(!allowed.includes(args.stage as any)) throw new Error("Campaign stage must be new, contacted, qualified, won, or lost.")
  const lead=await ctx.db.get(args.leadId); if(!lead) throw new Error("Lead not found.")
  await ctx.db.patch(lead._id,{status:args.stage as typeof lead.status,updatedAt:Date.now()})
  return null
}})

export const advance=internalMutation({args:{enrollmentId:v.id("campaignEnrollments"),campaignId:v.id("campaigns"),leadId:v.id("leads"),stepIndex:v.number(),type:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  const e=await ctx.db.get(args.enrollmentId); if(!e||e.status!=="active") return null
  const now=Date.now()
  await ctx.db.insert("campaignEvents",{campaignId:args.campaignId,enrollmentId:e._id,leadId:args.leadId,stepIndex:args.stepIndex,type:args.type==="email"?"email_sent":args.type==="create_task"?"task_created":args.type==="add_note"?"note_added":"stage_updated",detail:"Campaign step completed.",createdAt:now})
  const next=await ctx.db.query("campaignSteps").withIndex("by_campaign_and_order",q=>q.eq("campaignId",args.campaignId)).order("asc").collect().then(rows=>rows.find(s=>s.order===args.stepIndex+1)??null)
  if(!next){await ctx.db.patch(e._id,{status:"completed",completedAt:now,nextRunAt:undefined,currentStep:args.stepIndex});await ctx.db.insert("campaignEvents",{campaignId:args.campaignId,enrollmentId:e._id,leadId:args.leadId,stepIndex:args.stepIndex,type:"completed",detail:"Campaign sequence completed.",createdAt:now});return null}
  const nextRunAt=now+next.delayMinutes*60*1000
  await ctx.db.patch(e._id,{currentStep:next.order,nextRunAt})
  await ctx.db.insert("campaignEvents",{campaignId:args.campaignId,enrollmentId:e._id,leadId:args.leadId,stepIndex:next.order,type:"step_scheduled",detail:"Next sequence step scheduled.",createdAt:now})
  await ctx.scheduler.runAt(nextRunAt,internal.campaigns.executeStep,{enrollmentId:e._id})
  return null
}})
export const markFailed=internalMutation({args:{enrollmentId:v.id("campaignEnrollments"),campaignId:v.id("campaigns"),leadId:v.id("leads"),stepIndex:v.number(),error:v.string()},returns:v.null(),handler:async(ctx,args)=>{
  const e=await ctx.db.get(args.enrollmentId); if(!e) return null
  await ctx.db.patch(e._id,{status:"stopped",stoppedAt:Date.now(),nextRunAt:undefined})
  await ctx.db.insert("campaignEvents",{campaignId:args.campaignId,enrollmentId:e._id,leadId:args.leadId,stepIndex:args.stepIndex,type:"failed",detail:args.error.slice(0,500),createdAt:Date.now()})
  return null
}})