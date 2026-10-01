import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { internal, api } from "./_generated/api"
import { internalQuery, query, type QueryCtx } from "./_generated/server"
const OWNER_EMAIL="jabari.xai@gmail.com"
async function requireOwner(ctx:QueryCtx){const userId=await getAuthUserId(ctx);if(!userId)throw new Error("Authentication required.");const user=await ctx.db.get(userId);if(user?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.")}
export const listRecentProspectDrafts=query({args:{},returns:v.array(v.any()),handler:async(ctx)=>{await requireOwner(ctx);return await ctx.db.query("prospectOutreachDrafts").withIndex("by_status_and_updatedAt").order("desc").take(100)}})
export const outreachMetrics=query({args:{},returns:v.object({prospects:v.number(),analyzed:v.number(),drafts:v.number(),approved:v.number(),sent:v.number(),inboundLeads:v.number()}),handler:async(ctx)=>{await requireOwner(ctx);const prospects=await ctx.db.query("prospects").take(1000);const drafts=await ctx.db.query("prospectOutreachDrafts").take(1000);const leads=await ctx.db.query("leads").take(1000);return{prospects:prospects.filter(p=>p.qualificationStatus==="qualified" && p.status!=="discarded").length,analyzed:prospects.filter(p=>p.analysisStatus==="ready").length,drafts:drafts.length,approved:drafts.filter(d=>d.status==="approved").length,sent:drafts.filter(d=>d.status==="sent").length,inboundLeads:leads.length}}})
