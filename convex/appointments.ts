import { mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"

const OWNER_EMAIL="jabari.xai@gmail.com"
async function owner(ctx:any){
  const id=await getAuthUserId(ctx)
  if(!id)throw new Error("Authentication required.")
  const u=await ctx.db.get(id)
  if(u?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.")
}
async function syncOpportunityForAppointment(ctx:any,leadId:any,contactId:any,status:string,now:number){
  if(!leadId||status==="cancelled")return
  const opportunity=await ctx.db.query("opportunities").withIndex("by_leadId",q=>q.eq("leadId",leadId)).first()
  if(!opportunity||opportunity.stage==="won"||opportunity.stage==="lost")return
  const nextStage=status==="completed"?"negotiation":"proposal"
  const probability=status==="completed"?75:65
  if(opportunity.stage!==nextStage||opportunity.probability!==probability){
    await ctx.db.patch(opportunity._id,{stage:nextStage,probability,updatedAt:now})
    await ctx.db.insert("crmActivities",{
      contactId:contactId??opportunity.contactId,
      leadId,
      type:"status_changed",
      title:"Opportunity advanced from appointment",
      detail:nextStage+" · appointment "+status,
      createdAt:now
    })
  }
}
export const list=query({args:{from:v.number(),to:v.number()},handler:async(ctx,args)=>{
  await owner(ctx)
  return await ctx.db.query("appointments").withIndex("by_startAt",q=>q.gte("startAt",args.from).lt("startAt",args.to)).order("asc").take(200)
}})
export const create=mutation({args:{contactId:v.optional(v.id("contacts")),leadId:v.optional(v.id("leads")),title:v.string(),description:v.string(),startAt:v.number(),endAt:v.number(),location:v.string(),meetingUrl:v.optional(v.string())},handler:async(ctx,args)=>{
  await owner(ctx)
  if(args.endAt<=args.startAt)throw new Error("End time must be after start time.")
  const overlap=await ctx.db.query("appointments").withIndex("by_startAt",q=>q.gte("startAt",args.startAt).lt("startAt",args.endAt)).take(50)
  if(overlap.some(a=>a.status!=="cancelled"&&a.startAt<args.endAt&&a.endAt>args.startAt))throw new Error("That time overlaps another appointment.")
  const now=Date.now()
  const id=await ctx.db.insert("appointments",{...args,status:"scheduled",createdAt:now,updatedAt:now})
  if(args.contactId)await ctx.db.insert("crmActivities",{contactId:args.contactId,leadId:args.leadId,type:"appointment",title:"Appointment scheduled",detail:args.title+" · "+new Date(args.startAt).toLocaleString(),createdAt:now})
  await syncOpportunityForAppointment(ctx,args.leadId,args.contactId,"scheduled",now)
  return id
}})
export const updateStatus=mutation({args:{appointmentId:v.id("appointments"),status:v.union(v.literal("scheduled"),v.literal("confirmed"),v.literal("completed"),v.literal("cancelled"))},handler:async(ctx,args)=>{
  await owner(ctx)
  const a=await ctx.db.get(args.appointmentId)
  if(!a)throw new Error("Appointment not found.")
  if(a.status===args.status)return null
  const now=Date.now()
  await ctx.db.patch(a._id,{status:args.status,updatedAt:now})
  if(a.contactId)await ctx.db.insert("crmActivities",{contactId:a.contactId,leadId:a.leadId,type:"appointment",title:"Appointment "+args.status,detail:a.title,createdAt:now})
  await syncOpportunityForAppointment(ctx,a.leadId,a.contactId,args.status,now)
  return null
}})