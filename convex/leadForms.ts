import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { internal } from "./_generated/api"

const OWNER_EMAIL="jabari.xai@gmail.com"
async function owner(ctx:QueryCtx|MutationCtx){const id=await getAuthUserId(ctx);if(!id)throw new Error("Authentication required.");const identity=await ctx.auth.getUserIdentity();const identityEmail=String((identity as any)?.email??"").toLowerCase();if(identityEmail===OWNER_EMAIL)return;const u=await ctx.db.get(id);if(u?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.")}
const fieldValidator=v.object({key:v.string(),label:v.string(),type:v.union(v.literal("text"),v.literal("email"),v.literal("phone"),v.literal("textarea"),v.literal("company")),required:v.boolean()})

export const list=query({args:{},returns:v.array(v.any()),handler:async(ctx)=>{await owner(ctx);return await ctx.db.query("leadForms").withIndex("by_updatedAt").order("desc").take(50)}})
export const get=query({args:{formId:v.id("leadForms")},returns:v.any(),handler:async(ctx,args)=>{const f=await ctx.db.get(args.formId);if(!f||f.status!=="published")return null;return f}})
export const submissions=query({args:{formId:v.id("leadForms")},returns:v.array(v.any()),handler:async(ctx,args)=>{await owner(ctx);return await ctx.db.query("formSubmissions").withIndex("by_form_and_createdAt",q=>q.eq("formId",args.formId)).order("desc").take(100)}})
export const create=mutation({args:{name:v.string(),description:v.string(),fields:v.array(fieldValidator)},returns:v.id("leadForms"),handler:async(ctx,a)=>{await owner(ctx);if(!a.name.trim())throw new Error("Form name is required.");const now=Date.now();return await ctx.db.insert("leadForms",{name:a.name.trim(),description:a.description.trim(),status:"draft",fields:a.fields,source:"website_form",createdAt:now,updatedAt:now})}})
export const setStatus=mutation({args:{formId:v.id("leadForms"),status:v.union(v.literal("draft"),v.literal("published"),v.literal("paused"))},returns:v.null(),handler:async(ctx,a)=>{await owner(ctx);await ctx.db.patch(a.formId,{status:a.status,updatedAt:Date.now()});return null}})

export const submit=mutation({args:{formId:v.id("leadForms"),values:v.any(),honeypot:v.optional(v.string())},returns:v.object({ok:v.boolean(),submissionId:v.id("formSubmissions")}),handler:async(ctx,a)=>{
 const form=await ctx.db.get(a.formId);if(!form||form.status!=="published")throw new Error("This form is not available.")
 if(a.honeypot?.trim())throw new Error("Submission rejected.")
 const values=(a.values??{}) as Record<string,unknown>,get=(key:string)=>String(values[key]??"").trim()
 for(const field of form.fields)if(field.required&&!get(field.key))throw new Error(field.label+" is required.")
 const email=get("email").toLowerCase(),name=get("name"),phone=get("phone"),company=get("company"),message=get("message")||get("request")
 if(!name||!email||!email.includes("@"))throw new Error("A valid name and email are required.")
 const now=Date.now()
 const sessionId=await ctx.db.insert("anonymousSessions",{capability:"form:"+String(a.formId)+":"+now,createdAt:now,expiresAt:now+86400000,remainingMessages:0})
 const threadId=await ctx.db.insert("chatThreads",{sessionId,title:"Form submission: "+name,createdAt:now,updatedAt:now,nextOrder:1})
 const leadId=await ctx.db.insert("leads",{threadId,name,email,company,request:message||"Website form enquiry",budget:"",timeline:"",status:"new",createdAt:now,updatedAt:now})
 const contactId=await ctx.db.insert("contacts",{name,email,company,phone:phone||undefined,source:"website_form",leadId,createdAt:now,updatedAt:now})
 await ctx.db.insert("crmActivities",{contactId,leadId,type:"lead_created",title:"Lead captured from form",detail:form.name+" · "+(message||"Website form enquiry"),createdAt:now})
 const submissionId=await ctx.db.insert("formSubmissions",{formId:a.formId,name,email,phone:phone||undefined,company,message:message||"",rawFields:values,leadId,status:"processed",createdAt:now})
 await ctx.scheduler.runAfter(0,internal.workflows.executeForLead,{leadId,event:"lead_created",status:"new"})
 return {ok:true,submissionId}
}})