import { useEffect, useState } from "react"
import { neonFetch } from "../lib/neon-api"

export function GlobalCrmSearch(){
 const [q,setQ]=useState(""),[open,setOpen]=useState(false),[results,setResults]=useState<any>(null)
 useEffect(()=>{const value=q.trim();if(value.length<2){setResults(null);return};const t=setTimeout(()=>{void neonFetch("/api/crm-search?q="+encodeURIComponent(value)).then(setResults).catch(()=>setResults({contacts:[],companies:[],leads:[],prospects:[]}))},250);return()=>clearTimeout(t)},[q])
 const total=results?results.contacts.length+results.companies.length+results.leads.length+results.prospects.length:0
 const jump=(id:string)=>{document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"});setOpen(false)}
 return <div className="relative z-40 mx-auto mb-5 max-w-6xl">
  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2 shadow-lg"><span className="text-white/30">⌕</span><input value={q} onChange={e=>{setQ(e.target.value);setOpen(true)}} onFocus={()=>setOpen(true)} placeholder="Search contacts, companies, leads or prospects…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/25"/>{q&&<button onClick={()=>setQ("")} className="text-xs text-white/30">Clear</button>}</div>
  {open&&q.trim().length>=2&&<div className="absolute left-0 right-0 mt-2 max-h-[480px] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-2 shadow-2xl">{results===null?<p className="p-4 text-sm text-white/40">Searching…</p>:total===0?<p className="p-4 text-sm text-white/40">No CRM matches.</p>:<div className="space-y-1">
   {results.contacts.map((x:any)=><button key={x.id} onClick={()=>jump("contacts")} className="block w-full rounded-lg p-3 text-left hover:bg-white/5"><p className="text-sm font-semibold">{x.name}</p><p className="text-xs text-white/40">Contact · {x.company} · {x.email}</p></button>)}
   {results.companies.map((x:any)=><button key={x.id} onClick={()=>jump("companies")} className="block w-full rounded-lg p-3 text-left hover:bg-white/5"><p className="text-sm font-semibold">{x.name}</p><p className="text-xs text-white/40">Company · {x.industry||"Industry not set"}</p></button>)}
   {results.leads.map((x:any)=><button key={x.id} onClick={()=>jump("pipeline")} className="block w-full rounded-lg p-3 text-left hover:bg-white/5"><p className="text-sm font-semibold">{x.name}</p><p className="text-xs text-white/40">Lead · {x.company||"No company"} · {x.status}</p></button>)}
   {results.prospects.map((x:any)=><button key={x.id} onClick={()=>jump("research")} className="block w-full rounded-lg p-3 text-left hover:bg-white/5"><p className="text-sm font-semibold">{x.name}</p><p className="text-xs text-white/40">Prospect · {x.contactEmail||x.contactPhone||"No verified contact"}</p></button>)}
  </div>}</div>}
 </div>
}