import { useAction, useConvexAuth, useQuery } from "convex/react"
import { useEffect, useState } from "react"
import { api } from "../../convex/_generated/api"

const labels: Record<string,string> = {
  prospect_researched:"Prospect researched", prospect_analyzed:"Prospect analyzed",
  contact_verified:"Contact verified", contact_not_found:"Contact not found",
  contact_review_needed:"Contact needs review", draft_created:"Draft created",
  draft_updated:"Draft updated", draft_approved:"Draft approved",
  email_sent:"Email sent", email_bounced:"Email bounced",
}
function when(v:any){ return new Date(Number(v)).toLocaleString([], {dateStyle:"medium",timeStyle:"short"}) }

export function OutreachActivity(){
  const {isAuthenticated,isLoading}=useConvexAuth()
  const events=useQuery(api.outreach.recentEvents,isAuthenticated?{}:"skip")
  const syncGmail=useAction(api.outreach.syncGmailOutreach)
  const [syncing,setSyncing]=useState(false)
  const [syncMessage,setSyncMessage]=useState("")
  useEffect(()=>{
    if(!isAuthenticated) return
    setSyncing(true)
    void syncGmail().then(r=>setSyncMessage(r.synced ? `Gmail synced: ${r.synced} matched message${r.synced===1?"":"s"}.` : "Gmail is up to date.")).catch(e=>setSyncMessage(e instanceof Error ? e.message : "Gmail sync failed.")).finally(()=>setSyncing(false))
  },[isAuthenticated,syncGmail])
  if(isLoading||!isAuthenticated) return <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/40">Checking authentication…</section>
  if(events===undefined) return <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/40">Loading outreach activity…</section>
  const rows=events.filter((e:any)=>{const k=String(e.title||e.kind||"").toLowerCase();return k.includes("prospect")||k.includes("contact")||k.includes("email")||k.includes("draft")})
  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
    <div className="border-b border-white/10 px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Outreach activity</h2><p className="mt-1 text-xs text-white/40">Lifecycle history for research, Gmail sends, replies, and approved outreach.</p></div><button disabled={syncing} onClick={()=>{setSyncing(true);setSyncMessage("");void syncGmail().then(r=>setSyncMessage(r.synced ? `Gmail synced: ${r.synced} matched message${r.synced===1?"":"s"}.` : "Gmail is up to date.")).catch(e=>setSyncMessage(e instanceof Error ? e.message : "Gmail sync failed.")).finally(()=>setSyncing(false))}} className="rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/10 px-3 py-2 text-xs font-semibold text-[#d4af37] disabled:opacity-50">{syncing?"Syncing Gmail…":"Sync Gmail"}</button></div>{syncMessage&&<p className="mt-3 text-xs text-white/45">{syncMessage}</p>}</div>
    {rows.length===0?<p className="p-5 text-sm text-white/40">No outreach activity yet.</p>:<div className="divide-y divide-white/10">{rows.map((e:any)=><div key={String(e._id)} className="flex items-start justify-between gap-4 px-5 py-4"><div><p className="text-sm font-medium">{labels[e.kind]||e.title||e.kind}</p><p className="mt-1 text-xs text-white/45">{e.detail||e.prospect?.name||e.lead?.name||""}</p></div><span className="shrink-0 text-[10px] text-white/30">{when(e.createdAt)}</span></div>)}</div>}
  </section>
}
