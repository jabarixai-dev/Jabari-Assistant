import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { mutation, query } from "./_generated/server"

const OWNER_EMAIL="jabari.xai@gmail.com"
const defaults={
 identity:"Jabari Assistant, the AI representative for Jabari Tech.",
 services:"Website building, content writing, and practical AI-assisted digital workflows.",
 tone:"Concise, professional, friendly, practical.",
 qualification:"When a visitor shows genuine hiring intent, collect name, email, company or organization, request, budget if available, and timeline.",
 boundaries:"Do not invent prices, clients, portfolio items, guarantees, or company facts. If unsure, say so."
}
async function owner(ctx:any){const id=await getAuthUserId(ctx);if(!id)throw new Error("Authentication required.");return id}
export const get=query({args:{},returns:v.object({identity:v.string(),services:v.string(),tone:v.string(),qualification:v.string(),boundaries:v.string()}),handler:async(ctx)=>{await owner(ctx);const row=await ctx.db.query("agentSettings").first();return row?{identity:row.identity,services:row.services,tone:row.tone,qualification:row.qualification,boundaries:row.boundaries}:defaults}})
export const save=mutation({args:{identity:v.string(),services:v.string(),tone:v.string(),qualification:v.string(),boundaries:v.string()},returns:v.null(),handler:async(ctx,a)=>{await owner(ctx);const now=Date.now();const row=await ctx.db.query("agentSettings").first();if(row)await ctx.db.patch(row._id,{...a,updatedAt:now});else await ctx.db.insert("agentSettings",{...a,createdAt:now,updatedAt:now});return null}})
export const internalGet=query({args:{},returns:v.object({identity:v.string(),services:v.string(),tone:v.string(),qualification:v.string(),boundaries:v.string()}),handler:async(ctx)=>{const row=await ctx.db.query("agentSettings").first();return row?{identity:row.identity,services:row.services,tone:row.tone,qualification:row.qualification,boundaries:row.boundaries}:defaults}})
