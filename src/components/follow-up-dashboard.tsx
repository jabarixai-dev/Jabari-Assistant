import { useState } from "react"
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"

const fmt=(v?:number)=>v?new Date(v).toLocaleString(): "—"

export function FollowUpDashboard(){
 const {isAuthenticated}=useConvexAuth()
  const rows=useQuery(api.outreach.listFollowUpDashboard,isAuthenticated?{}:"skip") as any[]|undefined
  const pause=useMutation(api.outreach.pauseFollowUp)
  const cancel=useMutation(api.outreach.cancelProspectSend)
  const deleteFollowUp=useMutation(api.outreach.deleteFollowUp)
  const trigger=useAction(api.outreach.triggerFollowUp)
  const [busy,setBusy]=useState<string|null>(null)
  const [message,setMessage]=useState("")
  const act=async(id:string,fn:()=>Promise<any>,ok:string)=>{
    setBusy(id);setMessage("")
    try{await fn();setMessage(ok)}catch(e){setMessage(e instanceof Error?e.message:"Action failed.")}finally{setBusy(null)}
  }
  const counts={
    queued:(rows||[]).filter(r=>r.state==="queued").length,
    scheduled:(rows||[]).filter(r=>r.state==="scheduled").length,
    sent:(rows||[]).filter(r=>r.state==="follow_up_sent").length,
    bounced:(rows||[]).filter(r=>r.state==="bounced").length,
  }
  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
    <div className="border-b border-white/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold">Follow-up management</h2><p className="mt-1 text-xs text-white/40">Track scheduled follow-ups, stop automation, or trigger an eligible follow-up manually.</p></div>
        <span className="rounded-full border border-[#d4af37]/25 px-3 py-1 text-[10px] uppercase tracking-wider text-[#d4af37]">Automation control</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["queued","Queued"],["scheduled","Follow-ups scheduled"],["sent","Follow-ups sent"],["bounced","Bounced"]].map(([k,l])=><div key={k} className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-wider text-white/35">{l}</p><p className="mt-1 text-xl font-semibold">{counts[k as keyof typeof counts]}</p></div>)}
      </div>
      {message&&<p className="mt-4 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">{message}</p>}
    </div>
    <div className="divide-y divide-white/10">
      {rows===undefined?<p className="p-6 text-sm text-white/40">Loading follow-up queue…</p>:rows.length===0?<p className="p-6 text-sm text-white/40">No queued or sent outreach follow-ups yet.</p>:rows.map(r=>{
        const id=String(r._id),working=busy===id
        return <article key={id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-semibold">{r.name}</p><p className="mt-1 text-xs text-white/40">{r.recipientEmail}</p><p className="mt-1 text-xs text-white/55">{r.subject}</p></div>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-[#d4af37]">{r.state.replaceAll("_"," ")}</span>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-white/45 md:grid-cols-3">
            <p>Initial send: <span className="text-white/65">{fmt(r.sentAt)}</span></p>
            <p>Initial queue: <span className="text-white/65">{fmt(r.scheduledSendAt)}</span></p>
            <p>Follow-up: <span className="text-white/65">{fmt(r.followUpScheduledAt||r.followUpSentAt)}</span></p>
          </div>
          {r.deliveryError&&<p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{r.deliveryError}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {r.state==="queued"&&<button disabled={working} onClick={()=>void act(id,()=>cancel({draftId:r._id}),"Scheduled outreach cancelled.")} className="rounded-lg border border-red-500/20 px-3 py-2 text-xs text-red-300">Cancel send</button>}
            {r.state==="scheduled"&&<button disabled={working} onClick={()=>void act(id,()=>pause({draftId:r._id}),"Follow-up paused.")} className="rounded-lg border border-amber-500/20 px-3 py-2 text-xs text-amber-200">Pause follow-up</button>}
            {(r.state==="scheduled"||r.state==="sent")&&<button disabled={working} onClick={()=>void act(id,()=>trigger({draftId:r._id}),"Follow-up triggered.")} className="rounded-lg bg-[#d4af37] px-3 py-2 text-xs font-semibold text-black">Send follow-up now</button>}
            {r.state==="bounced"&&<span className="rounded-lg border border-red-500/20 px-3 py-2 text-xs text-red-300">Automation stopped</span>}
            {r.state==="follow_up_sent"&&<span className="rounded-lg border border-green-500/20 px-3 py-2 text-xs text-green-300">One follow-up completed</span>}
            <button disabled={working} onClick={()=>void act(id,()=>deleteFollowUp({draftId:r._id}),"Follow-up record deleted.")} className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300">Delete</button>
          </div>
        </article>
      })}
    </div>
  </section>
}
