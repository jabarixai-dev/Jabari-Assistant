import { useEffect, useState } from "react"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

export function CompaniesCrm(){
 const {isAuthenticated}=useConvexAuth()
  const [search,setSearch]=useState("")
  const [editing,setEditing]=useState<Id<"companies">|null>(null)
  const [form,setForm]=useState({website:"",industry:"",notes:""})
  const [message,setMessage]=useState("")
  const rows=useQuery(api.companies.list,isAuthenticated?{search:search||undefined}:"skip")
  const update=useMutation(api.companies.update)
  const sync=useMutation(api.companies.syncFromContacts)
  const save=async(id:Id<"companies">)=>{await update({companyId:id,website:form.website||undefined,industry:form.industry||undefined,notes:form.notes||undefined});setEditing(null);setMessage("Company updated.")}
  const runSync=async()=>{const r=await sync({});setMessage("Synced "+r.companies+" companies and linked "+r.linked+" contacts.")}
  return <section className="mt-8 scroll-mt-24 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
    <div className="border-b border-white/10 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.18em] text-[#d4af37]">CRM / Companies</p><h2 className="mt-1 text-xl font-bold">Company records</h2><p className="mt-1 text-sm text-white/40">Company context shared by contacts and leads.</p></div><div className="flex gap-2"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search companies…" className="w-44 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white"/><button onClick={()=>void runSync()} className="rounded-lg border border-[#d4af37]/30 px-3 py-2 text-xs text-[#d4af37]">Sync CRM</button></div></div>{message&&<p className="mt-3 text-xs text-green-300">{message}</p>}</div>
    <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">{rows===undefined?<p className="text-sm text-white/40">Loading companies…</p>:!rows.length?<p className="text-sm text-white/40">No company records yet.</p>:rows.map((c:any)=><article key={c._id} className="rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{c.name}</p><p className="mt-1 text-[10px] text-white/35">{c.industry||"Industry not set"}</p></div><button onClick={()=>{setEditing(c._id);setForm({website:c.website||"",industry:c.industry||"",notes:c.notes||""})}} className="text-[10px] text-[#d4af37]">Edit</button></div>{editing===c._id?<div className="mt-3 space-y-2"><input value={form.website} onChange={e=>setForm({...form,website:e.target.value})} placeholder="Company website" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white"/><input value={form.industry} onChange={e=>setForm({...form,industry:e.target.value})} placeholder="Industry" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white"/><textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Company notes" rows={3} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white"/><div className="flex gap-2"><button onClick={()=>void save(c._id)} className="rounded-lg bg-[#d4af37] px-3 py-2 text-xs font-semibold text-black">Save</button><button onClick={()=>setEditing(null)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/50">Cancel</button></div></div>:<div className="mt-3 space-y-1 text-xs text-white/45"><p>{c.website||"No website saved"}</p>{c.notes&&<p className="line-clamp-3">{c.notes}</p>}</div>}</article>)}</div>
  </section>
}
