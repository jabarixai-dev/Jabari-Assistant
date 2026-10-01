import { useEffect, useState } from "react"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"

const fields=[["identity","Assistant identity"],["services","Services and capabilities"],["tone","Tone and style"],["qualification","Lead qualification rules"],["boundaries","Boundaries and safety rules"]] as const

export function AgentControls(){
 const {isAuthenticated}=useConvexAuth()
 const data=useQuery(api.agentSettings.get,isAuthenticated?{}:"skip")
 const save=useMutation(api.agentSettings.save)
 const [form,setForm]=useState<Record<string,string>>({})
 const [saved,setSaved]=useState(false)
 useEffect(()=>{if(data)setForm(data)},[data])
 const submit=async()=>{await save({identity:form.identity||"",services:form.services||"",tone:form.tone||"",qualification:form.qualification||"",boundaries:form.boundaries||""});setSaved(true);setTimeout(()=>setSaved(false),1800)}
 return <section className="mt-8 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"><div className="border-b border-white/10 p-5"><p className="text-xs uppercase tracking-[.18em] text-[#d4af37]">AI agent</p><h2 className="mt-1 text-xl font-bold">Agent controls</h2><p className="mt-1 text-xs text-white/40">Control what the public Jabari Assistant knows and how it behaves.</p></div><div className="space-y-4 p-5">{!data?<p className="text-sm text-white/40">Loading settings…</p>:fields.map(([key,label])=><label key={key} className="block"><span className="mb-2 block text-xs font-medium text-white/60">{label}</span><textarea value={form[key]||""} onChange={e=>setForm({...form,[key]:e.target.value})} rows={key==="identity"?2:3} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"/></label>)}<div className="flex items-center gap-3"><button onClick={()=>void submit()} disabled={!data} className="rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-semibold text-black">Save agent settings</button>{saved&&<span className="text-xs text-green-300">Saved</span>}</div></div></section>
}