import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { query } from "./_generated/server"
const OWNER_EMAIL="jabari.xai@gmail.com"
async function owner(ctx:any){const id=await getAuthUserId(ctx);if(!id)throw new Error("Authentication required.");return id}
export const list= query({args:{},returns:v.array(v.any()),handler:async(ctx)=>{
  await owner(ctx)
  const events:any[]=[]
  const activities=await ctx.db.query("crmActivities").order("desc").take(100)
  for(const a of activities){const lead=a.leadId?await ctx.db.get(a.leadId):null;const contact=a.contactId?await ctx.db.get(a.contactId):null;events.push({id:"crm:"+a._id,kind:a.type,title:a.title,detail:a.detail,createdAt:a.createdAt,lead,contact})}
  const emails=await ctx.db.query("outreachEvents").withIndex("by_createdAt").order("desc").take(100)
  for(const e of emails){const lead=e.leadId?await ctx.db.get(e.leadId):null;const prospect=e.prospectId?await ctx.db.get(e.prospectId):null;events.push({id:"outreach:"+e._id,kind:"email",title:e.kind.replace(/_/g," "),detail:typeof e.metadata?.error==="string"?e.metadata.error:"Outreach activity",createdAt:e.createdAt,lead,prospect})}
  const appointments=await ctx.db.query("appointments").withIndex("by_startAt").order("desc").take(100)
  for(const a of appointments){const lead=a.leadId?await ctx.db.get(a.leadId):null;const contact=a.contactId?await ctx.db.get(a.contactId):null;events.push({id:"appointment:"+a._id,kind:"appointment",title:a.title,detail:a.status+" · "+new Date(a.startAt).toLocaleString(),createdAt:a.updatedAt,lead,contact})}
  const tasks=await ctx.db.query("workflowTasks").withIndex("by_status_and_updatedAt").order("desc").take(100)
  for(const t of tasks){const lead=await ctx.db.get(t.leadId);events.push({id:"task:"+t._id,kind:"workflow",title:t.title,detail:t.detail+" · "+t.status,createdAt:t.updatedAt,lead})}
  return events.sort((a,b)=>b.createdAt-a.createdAt).slice(0,150)
}})