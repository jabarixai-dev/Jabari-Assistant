import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"

type PublicCtx = QueryCtx | MutationCtx
const RUN_STALE_MS = 2 * 60 * 1000

async function requireSession(ctx: PublicCtx, capability: string) {
  if (!capability || capability.length < 32) throw new Error("Chat session not found.")
  const session = await ctx.db.query("anonymousSessions").withIndex("by_capability", q => q.eq("capability", capability)).unique()
  if (!session || session.revokedAt || session.expiresAt <= Date.now()) throw new Error("Chat session not found.")
  return session
}
async function authorizeThread(ctx: PublicCtx, capability: string, threadId: string) {
  const session = await requireSession(ctx, capability)
  const id = ctx.db.normalizeId("chatThreads", threadId)
  if (!id) throw new Error("Conversation not found.")
  const row = await ctx.db.get(id)
  if (!row || row.sessionId !== session._id) throw new Error("Conversation not found.")
  return { session, thread: row }
}
function safeMessage(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as { id:string; role:"user"|"assistant"; parts:Array<Record<string,unknown>> }
}

export const createAnonymousSessionRecord = internalMutation({
  args:{capability:v.string(),expiresAt:v.number(),remainingMessages:v.number()}, returns:v.id("anonymousSessions"),
  handler:async(ctx,args)=>{
    const collision=await ctx.db.query("anonymousSessions").withIndex("by_capability",q=>q.eq("capability",args.capability)).unique()
    if(collision) throw new Error("Could not create chat session.")
    return ctx.db.insert("anonymousSessions",{...args,createdAt:Date.now()})
  },
})

export const createNewThread = mutation({
  args:{capability:v.string()}, returns:v.id("chatThreads"),
  handler:async(ctx,args)=>{
    const session=await requireSession(ctx,args.capability)
    const existing=await ctx.db.query("chatThreads").withIndex("by_sessionId_and_updatedAt",q=>q.eq("sessionId",session._id)).take(20)
    if(existing.length>=20) throw new Error("This chat session has too many conversations.")
    const now=Date.now()
    return ctx.db.insert("chatThreads",{sessionId:session._id,title:"New conversation",createdAt:now,updatedAt:now,nextOrder:0})
  },
})

export const deleteThread = mutation({
  args:{capability:v.string(),threadId:v.string()}, returns:v.null(),
  handler:async(ctx,args)=>{
    const {thread}=await authorizeThread(ctx,args.capability,args.threadId)
    const messages=await ctx.db.query("chatMessages").withIndex("by_threadId_and_order",q=>q.eq("threadId",thread._id)).collect()
    for(const row of messages) await ctx.db.delete(row._id)
    const runs=await ctx.db.query("chatRuns").withIndex("by_threadId_and_userMessageId",q=>q.eq("threadId",thread._id)).collect()
    for(const run of runs){
      const chunks=await ctx.db.query("chatStreamChunks").withIndex("by_runId_and_start",q=>q.eq("runId",run._id)).collect()
      for(const chunk of chunks) await ctx.db.delete(chunk._id)
      await ctx.db.delete(run._id)
    }
    await ctx.db.delete(thread._id)
    return null
  },
})

export const listThreads = query({
  args:{capability:v.string()}, returns:v.any(),
  handler:async(ctx,args)=>{
    const session=await requireSession(ctx,args.capability)
    const rows=await ctx.db.query("chatThreads").withIndex("by_sessionId_and_updatedAt",q=>q.eq("sessionId",session._id)).order("desc").collect()
    return rows.map(({_id,_creationTime,title,updatedAt})=>({_id,_creationTime,title,updatedAt}))
  },
})

export const listMessages = query({
  args:{capability:v.string(),threadId:v.string()}, returns:v.any(),
  handler:async(ctx,args)=>{
    const {thread}=await authorizeThread(ctx,args.capability,args.threadId)
    const rows=await ctx.db.query("chatMessages").withIndex("by_threadId_and_order",q=>q.eq("threadId",thread._id)).order("asc").collect()
    return rows.slice(-50).map(row=>row.message)
  },
})

export const submitMessage = mutation({
  args:{capability:v.string(),threadId:v.string(),message:v.any()}, returns:v.id("chatRuns"),
  handler:async(ctx,args)=>{
    const {session,thread}=await authorizeThread(ctx,args.capability,args.threadId)
    const message=safeMessage(args.message)
    const textParts=message.parts.filter((part):part is {type:"text";text:string}=>part.type==="text"&&typeof part.text==="string")
    const text=textParts.map(part=>part.text).join("").trim()
    if(message.role!=="user"||!message.id||!text) throw new Error("A non-empty user message is required.")
    const existingRun=await ctx.db.query("chatRuns").withIndex("by_threadId_and_userMessageId",q=>q.eq("threadId",thread._id).eq("userMessageId",message.id)).unique()
    if(existingRun&&existingRun.status!=="failed") return existingRun._id
    const now=Date.now()
    let remainingMessages=session.remainingMessages
    if(thread.activeRunId&&thread.activeRunId!==existingRun?._id){
      const active=await ctx.db.get(thread.activeRunId)
      if(active&&(active.status==="scheduled"||active.status==="streaming")){
        if(now-active.updatedAt<RUN_STALE_MS) throw new Error("Wait for the current reply to finish.")
        await ctx.db.patch(active._id,{status:"failed",error:"The reply was interrupted. Please send your message again.",updatedAt:now})
        remainingMessages+=1
      }
    }
    if(remainingMessages<1) throw new Error("This anonymous chat has reached its message limit.")
    if(existingRun){
      const failedBatches=await ctx.db.query("chatStreamChunks").withIndex("by_runId_and_start",q=>q.eq("runId",existingRun._id)).collect()
      for(const batch of failedBatches) await ctx.db.delete(batch._id)
      await ctx.db.patch(existingRun._id,{status:"scheduled",attemptId:undefined,error:undefined,nextSeq:0,updatedAt:now})
      await ctx.db.patch(session._id,{remainingMessages:remainingMessages-1})
      await ctx.db.patch(thread._id,{activeRunId:existingRun._id,updatedAt:now})
      await ctx.scheduler.runAfter(0,internal.chatGeneration.generateReply,{runId:existingRun._id})
      return existingRun._id
    }
    await ctx.db.insert("chatMessages",{threadId:thread._id,messageId:message.id,role:"user",message:{id:message.id,role:"user",parts:textParts},order:thread.nextOrder??0,createdAt:now})
    const runId=await ctx.db.insert("chatRuns",{threadId:thread._id,userMessageId:message.id,assistantMessageId:crypto.randomUUID(),status:"scheduled",nextSeq:0,createdAt:now,updatedAt:now})
    await ctx.db.patch(session._id,{remainingMessages:remainingMessages-1})
    await ctx.db.patch(thread._id,{activeRunId:runId,nextOrder:(thread.nextOrder??0)+1,updatedAt:now})
    await ctx.scheduler.runAfter(0,internal.chatGeneration.generateReply,{runId})
    return runId
  },
})

export const getActiveRun = query({
  args:{capability:v.string(),threadId:v.string()},returns:v.any(),
  handler:async(ctx,args)=>{
    const {thread}=await authorizeThread(ctx,args.capability,args.threadId)
    if(!thread.activeRunId)return null
    const run=await ctx.db.get(thread.activeRunId)
    if(!run||(run.status!=="scheduled"&&run.status!=="streaming"))return null
    if(Date.now()-run.updatedAt>=RUN_STALE_MS)return null
    return {runId:run._id,status:run.status}
  },
})
export const streamRun = query({
  args:{capability:v.string(),runId:v.id("chatRuns"),cursor:v.number()},returns:v.any(),
  handler:async(ctx,args)=>{
    const session=await requireSession(ctx,args.capability); const run=await ctx.db.get(args.runId); const thread=run&&(await ctx.db.get(run.threadId))
    if(!run||!thread||thread.sessionId!==session._id)throw new Error("Reply stream not found.")
    const batches=await ctx.db.query("chatStreamChunks").withIndex("by_runId_and_start",q=>q.eq("runId",args.runId).gte("start",args.cursor)).order("asc").take(50)
    return {status:run.status,error:run.error,batches:batches.map(({start,end,chunks})=>({start,end,chunks}))}
  },
})
export const claimRun = internalMutation({
  args:{runId:v.id("chatRuns"),attemptId:v.string()},returns:v.any(),
  handler:async(ctx,args)=>{
    const run=await ctx.db.get(args.runId); if(!run||run.status!=="scheduled")return null
    const thread=await ctx.db.get(run.threadId); if(!thread||thread.activeRunId!==run._id)return null
    await ctx.db.patch(run._id,{status:"streaming",attemptId:args.attemptId,updatedAt:Date.now()})
    const messages=await ctx.db.query("chatMessages").withIndex("by_threadId_and_order",q=>q.eq("threadId",run.threadId)).order("asc").collect()
    return {threadId:run.threadId,assistantMessageId:run.assistantMessageId,messages:messages.slice(-30).map(row=>row.message)}
  },
})
export const appendChunks = internalMutation({
  args:{runId:v.id("chatRuns"),attemptId:v.string(),chunks:v.array(v.any())},returns:v.number(),
  handler:async(ctx,args)=>{
    const run=await ctx.db.get(args.runId); if(!run||run.status!=="streaming"||run.attemptId!==args.attemptId)throw new Error("Reply run is no longer active.")
    if(!args.chunks.length)return run.nextSeq
    const start=run.nextSeq,end=start+args.chunks.length
    await ctx.db.insert("chatStreamChunks",{runId:run._id,start,end,chunks:args.chunks,createdAt:Date.now()})
    await ctx.db.patch(run._id,{nextSeq:end,updatedAt:Date.now()}); return end
  },
})
export const completeRun = internalMutation({
  args:{runId:v.id("chatRuns"),attemptId:v.string(),message:v.any()},returns:v.null(),
  handler:async(ctx,args)=>{
    const run=await ctx.db.get(args.runId); if(!run||run.status!=="streaming"||run.attemptId!==args.attemptId)return null
    const thread=await ctx.db.get(run.threadId); if(!thread)return null
    const message=safeMessage(args.message)
    await ctx.db.insert("chatMessages",{threadId:thread._id,messageId:message.id,role:"assistant",message,order:thread.nextOrder??0,createdAt:Date.now()})
    await ctx.db.patch(run._id,{status:"completed",updatedAt:Date.now()})
    await ctx.db.patch(thread._id,{activeRunId:undefined,nextOrder:(thread.nextOrder??0)+1,updatedAt:Date.now()}); return null
  },
})
export const failRun = internalMutation({
  args:{runId:v.id("chatRuns"),attemptId:v.string(),error:v.string()},returns:v.null(),
  handler:async(ctx,args)=>{
    const run=await ctx.db.get(args.runId); if(!run||run.attemptId!==args.attemptId||run.status!=="streaming")return null
    await ctx.db.patch(run._id,{status:"failed",error:args.error,updatedAt:Date.now()})
    const thread=await ctx.db.get(run.threadId)
    if(thread?.activeRunId===run._id)await ctx.db.patch(thread._id,{activeRunId:undefined,updatedAt:Date.now()})
    const session=thread&&(await ctx.db.get(thread.sessionId))
    if(session)await ctx.db.patch(session._id,{remainingMessages:session.remainingMessages+1})
    return null
  },
})
export const inspectRun = internalQuery({args:{runId:v.id("chatRuns")},returns:v.any(),handler:async(ctx,args)=>ctx.db.get(args.runId)})
export type ChatThreadId=Id<"chatThreads">
