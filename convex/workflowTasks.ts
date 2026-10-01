import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { mutation, query } from "./_generated/server"
const OWNER_EMAIL="jabari.xai@gmail.com"
async function owner(ctx:any){const id=await getAuthUserId(ctx);if(!id)throw new Error("Authentication required.");return id}
export const list=query({args:{},returns:v.array(v.any()),handler:async(ctx)=>{await owner(ctx);const tasks=await ctx.db.query("workflowTasks").withIndex("by_status_and_updatedAt").order("desc").take(100);return await Promise.all(tasks.map(async t=>({task:t,lead:await ctx.db.get(t.leadId)})))}})
export const complete=mutation({args:{taskId:v.id("workflowTasks")},returns:v.null(),handler:async(ctx,a)=>{await owner(ctx);await ctx.db.patch(a.taskId,{status:"done",updatedAt:Date.now()});return null}})
