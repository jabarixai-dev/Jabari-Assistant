import { useEffect, useState } from "react"
import { neonFetch } from "../lib/neon-api"
const labels:any={lead:"Lead",lead_created:"Lead",status_changed:"Pipeline",email_sent:"Email",email:"Email",appointment:"Appointment",workflow:"Workflow"}
export function UnifiedFeed(){
 const [rows,setRows]=useState<any[]>([]);const [filter,setFilter]=useState("all")
 useEffect(()=>{neonFetch<any>("/api/activity-feed").then(r=>setRows(r.events||[])).catch(()=>{})},[])
 const filtered=rows.filter((x:any)=>filter==="all"||x.kind===filter)
 return <section className="mt-8 scroll-mt-24 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
  <div className="border-b border-white/10 p-5"><p className="text-xs uppercase tracking-[0.18em] text-[#d4af37]">Workspace / Activity</p><div className="mt-1 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Unified activity</h2><p className="mt-1 text-xs text-white/40">Leads, emails, appointments and workflows in one chronological stream.</p></div><div className="flex flex-wrap gap-1">{["all","lead","email","appointment","workflow"].map(x=><button key={x} onClick={()=>setFilter(x)} className={"rounded-full px-3 py-1.5 text-[10px] "+(filter===x?"bg-[#d4af37] text-black":"border border-white/10 text-white/45")}>{x==="all"?"All":labels[x]}</button>)}</div></div></div>
  <div className="divide-y divide-white/10">{filtered.length===0?<p className="p-6 text-sm text-white/40">No activity yet.</p>:filtered.slice(0,80).map((x:any)=><article key={x.id} className="flex gap-3 p-4"><div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#d4af37]"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{x.title}</p><time className="text-[9px] text-white/25">{new Date(x.createdAt).toLocaleString()}</time></div><p className="mt-1 text-xs text-white/45">{x.contact?.name||x.lead?.name||x.prospect?.name||"Workspace"}{x.contact?.company||x.lead?.company?" · "+(x.contact?.company||x.lead?.company):""}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-white/60">{x.detail}</p></div></article>)}</div>
 </section>
}
