import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { internal } from "./_generated/api"
import { internalAction, internalMutation, internalQuery, mutation, query, action, type MutationCtx, type QueryCtx } from "./_generated/server"
import { createMacalyLanguageModel } from "./macalyModel"
import { generateText } from "ai"
import { callMacalyJson } from "./macaly"
import { buildBrandedEmailHtml } from "./emailBrand"

const OWNER_EMAIL="jabari.xai@gmail.com"
async function requireOwner(ctx:QueryCtx|MutationCtx){const userId=await getAuthUserId(ctx);if(!userId)throw new Error("Authentication required.");const user=await ctx.db.get(userId);const identity=await ctx.auth.getUserIdentity();const identityEmail=String((identity as any)?.email??"").toLowerCase();if(identityEmail!==OWNER_EMAIL&&user?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.")}
function requiredEnv(name:string){const value=process.env[name];if(!value)throw new Error("Missing required Convex environment variable: "+name);return value}

export const listForLead=query({args:{leadId:v.id("leads")},returns:v.array(v.any()),handler:async(ctx,args)=>{await requireOwner(ctx);return await ctx.db.query("outreachDrafts").withIndex("by_leadId_and_updatedAt",q=>q.eq("leadId",args.leadId)).order("desc").take(10)}})
export const sendConversationReply=action({args:{leadId:v.id("leads"),subject:v.string(),bodyText:v.string()},returns:v.null(),handler:async(ctx,args)=>{
 const userId=await getAuthUserId(ctx);if(!userId)throw new Error("Authentication required.");
 const user=await ctx.runQuery(internal.outreach.getOwnerUser,{userId});if(user?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.");
 const lead=await ctx.runQuery(internal.outreach.getLeadForReply,{leadId:args.leadId});if(!lead||!lead.email.includes("@"))throw new Error("Lead email is unavailable.");
 const body=args.bodyText.trim(),subject=args.subject.trim()||("Re: "+lead.request);
 if(!body)throw new Error("Reply cannot be empty.");
 await sendEmail({ctx,toEmail:lead.email,subject,bodyText:body});
 await ctx.runMutation(internal.outreach.recordConversationReply,{leadId:lead._id,subject,bodyText:body});
 return null;
}})
export const fetchConversationEmails = action({
  args: {
    leadId: v.id("leads"),
  },

  returns: v.array(v.any()),

  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)

    if (!userId) {
      throw new Error("Authentication required.")
    }

    const user = await ctx.runQuery(
      internal.outreach.getOwnerUser,
      { userId },
    )

    if (user?.email?.toLowerCase() !== OWNER_EMAIL) {
      throw new Error("Owner access required.")
    }

    const lead = await ctx.runQuery(
      internal.outreach.getLeadForReply,
      { leadId: args.leadId },
    )

    if (!lead || !lead.email.includes("@")) {
      throw new Error("Lead email is unavailable.")
    }

    try {
      const email = lead.email.trim().toLowerCase()

      const result = await callMacalyJson(
        "/api/client-app/composio-execute",
        {
          action: "execute",
          toolName: "GMAIL_FETCH_EMAILS",
          appName: "GMAIL",
          params: {
            user_id: "me",
            query: `"${email}" newer_than:90d`,
            max_results: 30,
            verbose: false,
            include_payload: false,
          },
        },
      )

      const raw = (result.result ?? {}) as Record<string, any>

      if (raw._truncated) {
        throw new Error("Gmail returned too much data.")
      }

      if (raw.successful === false) {
        throw new Error(
          String(
            raw.error ??
              "Gmail could not retrieve the conversation.",
          ),
        )
      }

      const messages = Array.isArray(raw.data?.messages)
        ? raw.data.messages
        : []

      return messages
        .map((m: any) => ({
          id: String(
            m.id ??
              m.messageId ??
              Math.random(),
          ),

          from: String(
            m.sender ??
              m.from ??
              "",
          ),

          to: String(
            m.recipient ??
              m.to ??
              "",
          ),

          subject: String(
            m.subject ??
              "",
          ),

          preview: String(
            m.preview?.body ??
              m.messageText ??
              m.snippet ??
              "",
          ),

          date: String(
            m.date ??
              m.timestamp ??
              "",
          ),
        }))
        .slice(0, 30)
    } catch (error) {
      console.error(
        "[outreach] fetchConversationEmails failed:",
        error,
      )

      throw new Error(
        error instanceof Error
          ? error.message
          : "Unable to retrieve the Gmail conversation.",
      )
    }
  },
})

export const createDraft=mutation({args:{leadId:v.id("leads")},returns:v.id("outreachDrafts"),handler:async(ctx,args)=>{await requireOwner(ctx);const lead=await ctx.db.get(args.leadId);if(!lead||!lead.email.includes("@"))throw new Error("Lead has no valid email.");const now=Date.now();const id=await ctx.db.insert("outreachDrafts",{leadId:lead._id,subject:"Drafting your Jabari Tech enquiry follow-up…",bodyText:"The AI is preparing a personalized draft. You can review it before anything is sent.",status:"draft",createdAt:now,updatedAt:now});await ctx.db.insert("outreachEvents",{kind:"draft_created",leadId:lead._id,metadata:{channel:"inbound"},createdAt:now});await ctx.scheduler.runAfter(0,internal.outreach.generateDraft,{draftId:id});return id}})
export const updateDraft=mutation({args:{draftId:v.id("outreachDrafts"),subject:v.string(),bodyText:v.string()},returns:v.null(),handler:async(ctx,args)=>{await requireOwner(ctx);const draft=await ctx.db.get(args.draftId);if(!draft||draft.status==="sent"||draft.status==="cancelled")throw new Error("This draft can no longer be edited.");await ctx.db.patch(draft._id,{subject:args.subject.trim(),bodyText:args.bodyText.trim(),status:"draft",updatedAt:Date.now()});await ctx.db.insert("outreachEvents",{kind:"draft_updated",leadId:draft.leadId,metadata:{draftId:String(draft._id)},createdAt:Date.now()});return null}})
export const approveDraft=mutation({args:{draftId:v.id("outreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{await requireOwner(ctx);const draft=await ctx.db.get(args.draftId);if(!draft)throw new Error("Draft not found.");if(draft.status==="approved")return null;if(draft.status!=="draft")throw new Error("This draft can no longer be approved.");await ctx.db.patch(draft._id,{status:"approved",updatedAt:Date.now()});await ctx.db.insert("outreachEvents",{kind:"draft_approved",leadId:draft.leadId,metadata:{draftId:String(draft._id)},createdAt:Date.now()});return null}})
export const sendApprovedDraft=action({args:{draftId:v.id("outreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const userId=await getAuthUserId(ctx);if(!userId)throw new Error("Authentication required.");const user=await ctx.runQuery(internal.outreach.getOwnerUser,{userId});if(user?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.");const draft=await ctx.runQuery(internal.outreach.getSendContext,{draftId:args.draftId});if(!draft||draft.status!=="approved")throw new Error("Only approved drafts can be sent.");await sendEmail({ctx,toEmail:draft.lead.email,subject:draft.subject,bodyText:draft.bodyText});await ctx.runMutation(internal.outreach.markSent,{draftId:args.draftId});return null}})

export const listRecentProspectDrafts=query({args:{},returns:v.array(v.any()),handler:async(ctx)=>{await requireOwner(ctx);return await ctx.db.query("prospectOutreachDrafts").withIndex("by_status_and_updatedAt").order("desc").take(100)}})
export const createProspectDraft=mutation({args:{prospectId:v.id("prospects")},returns:v.id("prospectOutreachDrafts"),handler:async(ctx,args)=>{await requireOwner(ctx);const p=await ctx.db.get(args.prospectId);if(!p)throw new Error("Prospect not found.");const email=p.contactEmail?.trim().toLowerCase();if(!email||!email.includes("@")||p.contactStatus!=="verified")throw new Error("A publicly verified contact email is required before creating outreach.");const existing=await ctx.db.query("prospectOutreachDrafts").withIndex("by_prospectId_and_updatedAt",q=>q.eq("prospectId",p._id)).order("desc").first();if(existing&&existing.status!=="sent"&&existing.status!=="cancelled")return existing._id;const now=Date.now();return await ctx.db.insert("prospectOutreachDrafts",{prospectId:p._id,recipientEmail:email,subject:p.outreachSubject||"A quick idea for "+p.name,bodyText:p.outreachBody||"I noticed your business while researching your space and wanted to share a quick idea.",status:"draft",createdAt:now,updatedAt:now})}})
export const updateProspectDraft=mutation({args:{draftId:v.id("prospectOutreachDrafts"),subject:v.string(),bodyText:v.string()},returns:v.null(),handler:async(ctx,args)=>{await requireOwner(ctx);const d=await ctx.db.get(args.draftId);if(!d||d.status==="sent"||d.status==="cancelled")throw new Error("This draft can no longer be edited.");await ctx.db.patch(d._id,{subject:args.subject.trim(),bodyText:args.bodyText.trim(),status:"draft",updatedAt:Date.now()});await ctx.db.insert("outreachEvents",{kind:"draft_updated",prospectId:d.prospectId,draftId:d._id,createdAt:Date.now()});return null}})
export const approveProspectDraft=mutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{
  await requireOwner(ctx);
  const d=await ctx.db.get(args.draftId);
  if(!d)throw new Error("Draft not found.");
  if(d.status==="approved")return null;
  if(d.status!=="draft")throw new Error("This draft can no longer be approved.");
  const now=Date.now();
  const pending=await ctx.db.query("prospectOutreachDrafts").withIndex("by_status_and_updatedAt",q=>q.eq("status","approved")).collect();
  const lastScheduled=pending.reduce((max,row)=>Math.max(max,row.scheduledSendAt||0),0);
  const scheduledSendAt=Math.max(now+60*60*1000,lastScheduled+60*60*1000);
  await ctx.db.patch(d._id,{status:"approved",approvedAt:now,scheduledSendAt,updatedAt:now});
  await ctx.db.insert("outreachEvents",{kind:"draft_approved",prospectId:d.prospectId,draftId:d._id,metadata:{scheduledSendAt},createdAt:now});
  await ctx.scheduler.runAt(scheduledSendAt,internal.outreach.sendScheduledProspectDraft,{draftId:d._id});
  return null;
}})
export const sendScheduledProspectDraft=internalAction({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{
  const d=await ctx.runQuery(internal.outreach.getProspectSendContext,{draftId:args.draftId});
  if(!d||d.status!=="approved")return null;
  try{
    await sendEmail({ctx,toEmail:d.recipientEmail,subject:d.subject,bodyText:d.bodyText});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(/550|554|mailbox|address not found|recipient.*(invalid|unknown)|undeliver/i.test(message))await ctx.runMutation(internal.outreach.markProspectUndeliverable,{draftId:args.draftId,error:message});
    else await ctx.runMutation(internal.outreach.markProspectSendFailed,{draftId:args.draftId,error:message});
    return null;
  }
  await ctx.runMutation(internal.outreach.markProspectSent,{draftId:args.draftId});
  return null;
}})

export const sendApprovedProspectDraft=action({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const userId=await getAuthUserId(ctx);if(!userId)throw new Error("Authentication required.");const user=await ctx.runQuery(internal.outreach.getOwnerUser,{userId});if(user?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.");const d=await ctx.runQuery(internal.outreach.getProspectSendContext,{draftId:args.draftId});if(!d||d.status!=="approved")throw new Error("Only approved drafts can be sent.");try{await sendEmail({ctx,toEmail:d.recipientEmail,subject:d.subject,bodyText:d.bodyText});}catch(error){const message=error instanceof Error?error.message:String(error);if(/550|554|mailbox|address not found|recipient.*(invalid|unknown)|undeliver/i.test(message))await ctx.runMutation(internal.outreach.markProspectUndeliverable,{draftId:args.draftId,error:message});throw error}await ctx.runMutation(internal.outreach.markProspectSent,{draftId:args.draftId});return null}})

export const getProspectForFollowUp=internalQuery({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.any(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);return d?await ctx.db.get(d.prospectId):null}})
export const getProspectReplies=internalQuery({args:{prospectId:v.id("prospects"),after:v.number()},returns:v.array(v.any()),handler:async(ctx,args)=>{const rows=await ctx.db.query("outreachEvents").withIndex("by_createdAt").order("desc").take(200);return rows.filter(r=>r.prospectId===args.prospectId&&r.kind==="email_received"&&r.createdAt>args.after)}})
export const sendNoReplyFollowUp=internalAction({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{
const d=await ctx.runQuery(internal.outreach.getProspectSendContext,{draftId:args.draftId});if(!d||d.status!=="sent"||d.deliveryStatus==="undeliverable"||d.followUpSentAt||!d.followUpScheduledAt)return null
const replies=await ctx.runQuery(internal.outreach.getProspectReplies,{prospectId:d.prospectId,after:d.sentAt??0});if(replies.length){await ctx.runMutation(internal.outreach.stopFollowUpForReply,{draftId:d._id});return null}
const prospect=await ctx.runQuery(internal.outreach.getProspectForFollowUp,{draftId:args.draftId});if(!prospect)return null
try{await sendEmail({ctx,toEmail:d.recipientEmail,subject:/^re:/i.test(d.subject)?d.subject:"Re: "+d.subject,bodyText:"Hi "+(prospect.name||"there")+",\n\nJust following up on my previous email in case it got buried. If a professional website is still on your radar, I’d be happy to discuss your requirements.\n\nBest,\nJabari Tech\nWebsite Builder/Content Writer"});await ctx.runMutation(internal.outreach.markNoReplyFollowUpSent,{draftId:d._id})}catch(error){}
return null
}})
export const markNoReplyFollowUpSent=internalMutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d)return null;await ctx.db.patch(d._id,{followUpSentAt:Date.now(),followUpScheduledAt:undefined,updatedAt:Date.now()});return null}})
export const listFollowUpDashboard=query({args:{},returns:v.array(v.any()),handler:async(ctx)=>{
 await requireOwner(ctx);const rows=await ctx.db.query("prospectOutreachDrafts").withIndex("by_status_and_updatedAt").order("desc").take(200);const out:any[]=[];
 for(const d of rows){if(d.status!=="sent"&&d.status!=="approved")continue;const p=await ctx.db.get(d.prospectId);let state="sent";if(d.deliveryStatus==="undeliverable")state="bounced";else if(d.followUpSentAt)state="follow_up_sent";else if(d.followUpScheduledAt)state="scheduled";else if(d.status==="approved")state="queued";out.push({_id:d._id,prospectId:d.prospectId,name:p?.name||"Unknown prospect",recipientEmail:d.recipientEmail,subject:d.subject,status:d.status,state,sentAt:d.sentAt,scheduledSendAt:d.scheduledSendAt,followUpScheduledAt:d.followUpScheduledAt,followUpSentAt:d.followUpSentAt,deliveryStatus:d.deliveryStatus,deliveryError:d.deliveryError,updatedAt:d.updatedAt});}return out;
}})
export const pauseFollowUp=mutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{await requireOwner(ctx);const d=await ctx.db.get(args.draftId);if(!d)throw new Error("Draft not found.");if(d.status!=="sent")throw new Error("Only sent outreach can have a follow-up paused.");if(!d.followUpScheduledAt)return null;await ctx.db.patch(d._id,{followUpScheduledAt:undefined,updatedAt:Date.now()});await ctx.db.insert("outreachEvents",{kind:"follow_up_paused",prospectId:d.prospectId,draftId:d._id,createdAt:Date.now()});return null;}})
export const cancelProspectSend=mutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{await requireOwner(ctx);const d=await ctx.db.get(args.draftId);if(!d)throw new Error("Draft not found.");if(d.status!=="approved")throw new Error("Only queued outreach can be cancelled.");await ctx.db.patch(d._id,{status:"cancelled",scheduledSendAt:undefined,updatedAt:Date.now()});await ctx.db.insert("outreachEvents",{kind:"outreach_cancelled",prospectId:d.prospectId,draftId:d._id,createdAt:Date.now()});return null;}})
export const stopFollowUpForReply=internalMutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d)return null;const now=Date.now();await ctx.db.patch(d._id,{followUpScheduledAt:undefined,updatedAt:now});await ctx.db.insert("outreachEvents",{kind:"follow_up_stopped",prospectId:d.prospectId,draftId:d._id,metadata:{reason:"reply_received"},createdAt:now});return null}})
export const clearFollowUpSchedule=internalMutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d)return null;await ctx.db.patch(d._id,{followUpScheduledAt:undefined,updatedAt:Date.now()});return null;}})
export const triggerFollowUp=action({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{
 const userId=await getAuthUserId(ctx);if(!userId)throw new Error("Authentication required.");const user=await ctx.runQuery(internal.outreach.getOwnerUser,{userId});if(user?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.");
 const d=await ctx.runQuery(internal.outreach.getProspectSendContext,{draftId:args.draftId});if(!d||d.status!=="sent"||d.deliveryStatus==="undeliverable"||d.followUpSentAt)throw new Error("This outreach is not eligible for a follow-up.");
 const replies=await ctx.runQuery(internal.outreach.getProspectReplies,{prospectId:d.prospectId,after:d.sentAt??0});if(replies.length)throw new Error("A reply was detected, so the follow-up is stopped.");
 await ctx.runMutation(internal.outreach.clearFollowUpSchedule,{draftId:d._id});await ctx.runAction(internal.outreach.sendNoReplyFollowUp,{draftId:d._id});return null;
}})
export const checkProspectDelivery=action({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.object({status:v.string(),error:v.optional(v.string())}),handler:async(ctx,args)=>{
  const userId=await getAuthUserId(ctx);if(!userId)throw new Error("Authentication required.")
  const user=await ctx.runQuery(internal.outreach.getOwnerUser,{userId});if(user?.email?.toLowerCase()!==OWNER_EMAIL)throw new Error("Owner access required.")
  const d=await ctx.runQuery(internal.outreach.getProspectSendContext,{draftId:args.draftId});if(!d||d.status!=="sent")throw new Error("Only sent drafts can be checked.")
  const result=await callMacalyJson("/api/client-app/composio-execute",{action:"execute",toolName:"GMAIL_FETCH_EMAILS",appName:"GMAIL",params:{user_id:"me",query:"\""+d.recipientEmail+"\" newer_than:30d",max_results:20,verbose:false,include_payload:false}})
  const raw=(result.result??{}) as Record<string,any>
  if(raw._truncated)throw new Error("Gmail returned too much data while checking delivery.")
  const messages=Array.isArray(raw.data?.messages)?raw.data.messages:[]
  const bounce=messages.find((m:any)=>{
    const sender=String(m.sender??"").toLowerCase()
    const subject=String(m.subject??"").toLowerCase()
    const preview=String(m.preview?.body??m.messageText??"").toLowerCase()
    return /(mailer-daemon|postmaster|mail delivery subsystem|mail delivery service)/i.test(sender+" "+subject) ||
      /(delivery status notification|undeliverable|address not found|mailbox.*disabled|recipient.*(failed|rejected)|user unknown|delivery failed|couldn't be delivered|cannot be delivered)/i.test(subject+" "+preview)
  })
  if(bounce){
    const error=[bounce.subject,bounce.preview?.body].filter(Boolean).join(" — ").slice(0,500)
    await ctx.runMutation(internal.outreach.markProspectUndeliverable,{draftId:args.draftId,error:error||"Gmail reported a delivery failure."})
    return {status:"undeliverable",error:error||"Gmail reported a delivery failure."}
  }
  await ctx.runMutation(internal.outreach.markProspectDeliveryChecked,{draftId:args.draftId})
  return {status:"unknown"}
}})

function buildOutreachEmailHtml({bodyText}:{bodyText:string}){const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");const paragraphs=bodyText.trim().split("\n\n").map(p=>"<p style=\"margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#333;\">"+esc(p).replace(/\n/g,"<br>")+"</p>").join("");return "<!doctype html><html><body style=\"margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#333;\"><div style=\"max-width:640px;margin:24px auto;padding:0 20px;\"><div style=\"padding-bottom:16px;border-bottom:1px solid #e5e7eb;font-size:16px;font-weight:600;color:#111;\">Jabari Tech</div><div style=\"padding:24px 0;\">"+paragraphs+"</div><div style=\"padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#777;\">Jabari Tech · Website Builder & Content Writer</div></div></body></html>"}
async function sendEmail({ctx,toEmail,subject,bodyText}:{ctx:any,toEmail:string,subject:string,bodyText:string}){
  const body=buildOutreachEmailHtml({bodyText:bodyText.trim()})
  const plainText=bodyText.trim()
  const data=await callMacalyJson("/api/client-app/composio-execute",{
    action:"execute",
    toolName:"GMAIL_SEND_EMAIL",
    appName:"GMAIL",
    params:{user_id:"me",recipient_email:toEmail,from_email:OWNER_EMAIL,subject:subject.trim(),body,body_text:plainText,is_html:true},
  })
  const result=(data.result??{}) as Record<string,unknown>
  if(result._truncated) throw new Error("Gmail returned an unexpectedly large response.")
  if(result.successful===false) throw new Error(String(result.error??"Gmail rejected the send request."))
}
export const generateDraft=internalAction({args:{draftId:v.id("outreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const draft=await ctx.runQuery(internal.outreach.getDraftContext,{draftId:args.draftId});if(!draft)return null;const result=await generateText({model:createMacalyLanguageModel({baseUrl:requiredEnv("MACALY_BASE_URL"),apiToken:requiredEnv("MACALY_API_TOKEN"),chatId:requiredEnv("MACALY_CHAT_ID"),bypassHeader:process.env.MACALY_BYPASS_HEADER,preset:"CODE"}),system:"Write concise, professional, low-pressure outreach for Jabari Tech. Use only supplied lead details. Do not invent facts, clients, prices, results, guarantees, or prior conversations. Return exactly SUBJECT: and BODY: sections.",prompt:JSON.stringify({lead:draft.lead,conversation:draft.messages})});const text=result.text.trim(),sm=text.match(/^SUBJECT:\s*(.+?)(?:\n|$)/i),bm=text.match(/BODY:\s*([\s\S]*)$/i);await ctx.runMutation(internal.outreach.saveGeneratedDraft,{draftId:args.draftId,subject:sm?.[1]?.trim()||"Following up on your Jabari Tech enquiry",bodyText:bm?.[1]?.trim()||text});return null}})
export const getLeadForReply=internalQuery({args:{leadId:v.id("leads")},returns:v.any(),handler:async(ctx,args)=>ctx.db.get(args.leadId)})
export const recordConversationReply=internalMutation({args:{leadId:v.id("leads"),subject:v.string(),bodyText:v.string()},returns:v.null(),handler:async(ctx,args)=>{const lead=await ctx.db.get(args.leadId);if(!lead)return null;const contact=await ctx.db.query("contacts").withIndex("by_email",q=>q.eq("email",lead.email.toLowerCase())).first();const now=Date.now();await ctx.db.insert("outreachEvents",{kind:"conversation_reply_sent",leadId:lead._id,metadata:{subject:args.subject,bodyText:args.bodyText,channel:"email"},createdAt:now});if(contact)await ctx.db.insert("crmActivities",{contactId:contact._id,leadId:lead._id,type:"email_sent",title:"Conversation reply sent",detail:args.subject,createdAt:now});return null}})
export const getOwnerUser=internalQuery({args:{userId:v.id("users")},returns:v.any(),handler:async(ctx,args)=>ctx.db.get(args.userId)})
export const getSendContext=internalQuery({args:{draftId:v.id("outreachDrafts")},returns:v.any(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d)return null;const lead=await ctx.db.get(d.leadId);return lead?{status:d.status,subject:d.subject,bodyText:d.bodyText,lead:{email:lead.email}}:null}})
export const markSent=internalMutation({args:{draftId:v.id("outreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d||d.status!=="approved")return null;await ctx.db.patch(d._id,{status:"sent",sentAt:Date.now(),updatedAt:Date.now()});await ctx.db.insert("outreachEvents",{kind:"email_sent",leadId:d.leadId,metadata:{draftId:String(d._id)},createdAt:Date.now()});return null}})
export const getDraftContext=internalQuery({args:{draftId:v.id("outreachDrafts")},returns:v.any(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d)return null;const lead=await ctx.db.get(d.leadId);if(!lead)return null;const messages=await ctx.db.query("chatMessages").withIndex("by_threadId_and_order",q=>q.eq("threadId",lead.threadId)).order("asc").take(100);return{lead,messages:messages.map(row=>row.message)}}})
export const saveGeneratedDraft=internalMutation({args:{draftId:v.id("outreachDrafts"),subject:v.string(),bodyText:v.string()},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d||d.status!=="draft")return null;await ctx.db.patch(d._id,{subject:args.subject,bodyText:args.bodyText,updatedAt:Date.now()});return null}})
export const getProspectSendContext=internalQuery({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.any(),handler:async(ctx,args)=>ctx.db.get(args.draftId)})
export const markProspectSent=internalMutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d||d.status!=="approved")return null;const now=Date.now();const followUpAt=now+72*60*60*1000;await ctx.db.patch(d._id,{status:"sent",deliveryStatus:"unknown",deliveryError:undefined,lastDeliveryCheckAt:undefined,sentAt:now,followUpScheduledAt:followUpAt,updatedAt:now});await ctx.db.insert("outreachEvents",{kind:"email_sent",prospectId:d.prospectId,draftId:d._id,createdAt:now});await ctx.db.insert("outreachEvents",{kind:"follow_up_scheduled",prospectId:d.prospectId,draftId:d._id,metadata:{scheduledAt:followUpAt},createdAt:now});await ctx.scheduler.runAt(followUpAt,internal.outreach.sendNoReplyFollowUp,{draftId:d._id});return null}})
export const markProspectSendFailed=internalMutation({args:{draftId:v.id("prospectOutreachDrafts"),error:v.string()},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d)return null;await ctx.db.patch(d._id,{deliveryStatus:"unknown",deliveryError:args.error.slice(0,500),lastDeliveryCheckAt:Date.now(),updatedAt:Date.now()});await ctx.db.insert("outreachEvents",{kind:"contact_review_needed",prospectId:d.prospectId,draftId:d._id,metadata:{reason:"scheduled_send_failed",error:args.error.slice(0,500)},createdAt:Date.now()});return null}})
export const markProspectUndeliverable=internalMutation({args:{draftId:v.id("prospectOutreachDrafts"),error:v.string()},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d)return null;await ctx.db.patch(d._id,{deliveryStatus:"undeliverable",deliveryError:args.error.slice(0,500),lastDeliveryCheckAt:Date.now(),followUpScheduledAt:undefined,updatedAt:Date.now()});await ctx.db.insert("outreachEvents",{kind:"contact_review_needed",prospectId:d.prospectId,draftId:d._id,metadata:{reason:"email_undeliverable",error:args.error.slice(0,500)},createdAt:Date.now()});return null}})
export const markProspectDeliveryChecked=internalMutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async(ctx,args)=>{const d=await ctx.db.get(args.draftId);if(!d)return null;await ctx.db.patch(d._id,{deliveryStatus:"unknown",lastDeliveryCheckAt:Date.now(),updatedAt:Date.now()});return null}})
export const recordInboundEmails=internalMutation({args:{leadId:v.id("leads"),messages:v.array(v.object({id:v.string(),from:v.string(),to:v.string(),subject:v.string(),preview:v.string(),date:v.string()}))},returns:v.null(),handler:async(ctx,args)=>{const lead=await ctx.db.get(args.leadId);if(!lead)return null;for(const m of args.messages){const exists=await ctx.db.query("outreachEvents").withIndex("by_createdAt").order("desc").take(200);if(exists.some(e=>e.leadId===lead._id&&e.kind==="email_received"&&String(e.metadata?.gmailMessageId??"")===m.id))continue;await ctx.db.insert("outreachEvents",{kind:"email_received",leadId:lead._id,metadata:{gmailMessageId:m.id,from:m.from,to:m.to,subject:m.subject,preview:m.preview},createdAt:Date.parse(m.date)||Date.now()})}return null}})
export const markProspectAttempt=internalMutation({args:{draftId:v.id("prospectOutreachDrafts")},returns:v.null(),handler:async()=>null})
export const getQueueCandidates=internalQuery({args:{now:v.number()},returns:v.object({approved:v.array(v.any()),sent:v.array(v.any())}),handler:async(ctx,args)=>{const approved=await ctx.db.query("prospectOutreachDrafts").withIndex("by_status_and_updatedAt",q=>q.eq("status","approved")).collect();const sent=await ctx.db.query("prospectOutreachDrafts").withIndex("by_status_and_updatedAt",q=>q.eq("status","sent")).collect();return{approved:approved.filter(d=>(d.scheduledSendAt??0)<=args.now),sent:sent.filter(d=>d.sentAt&&args.now-d.sentAt<48*60*60*1000)}}})
export const processOutreachQueue=internalAction({args:{},returns:v.null(),handler:async(ctx)=>{const q=await ctx.runQuery(internal.outreach.getQueueCandidates,{now:Date.now()});for(const d of q.approved){await ctx.runAction(internal.outreach.sendScheduledProspectDraft,{draftId:d._id})}return null}})
export const recentEvents=query({args:{},returns:v.array(v.any()),handler:async(ctx)=>{await requireOwner(ctx);const events=await ctx.db.query("outreachEvents").withIndex("by_createdAt").order("desc").take(30);return await Promise.all(events.map(async(e)=>({ ...e, prospect:e.prospectId?await ctx.db.get(e.prospectId):null })))}})
