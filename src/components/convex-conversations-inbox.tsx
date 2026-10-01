import { useEffect, useState } from "react"
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

type Draft={_id:Id<"outreachDrafts">;subject:string;bodyText:string;status:string;sentAt?:number}
type DraftEdit={subject:string;bodyText:string}

export function ConvexConversationsInbox(){
 const {isAuthenticated}=useConvexAuth()
 const leads=useQuery(api.leads.listRecentForOwner,isAuthenticated?{}:"skip")||[]
 const [selected,setSelected]=useState<Id<"leads">|null>(null)
 const [search,setSearch]=useState("")
 const [filter,setFilter]=useState("all")
 const [emails,setEmails]=useState<any[]>([])
 const [edits,setEdits]=useState<Record<string,DraftEdit>>({})
 const [busy,setBusy]=useState(false)
 const [status,setStatus]=useState("")
 const detail=useQuery(api.leads.getLeadForOwner,selected?{leadId:selected}:"skip")
 const drafts=useQuery(api.outreach.listForLead,selected?{leadId:selected}:"skip") as Draft[]|undefined
 const fetchEmails=useAction(api.outreach.fetchConversationEmails)
 const createDraft=useMutation(api.outreach.createDraft)
 const updateDraft=useMutation(api.outreach.updateDraft)
 const approveDraft=useMutation(api.outreach.approveDraft)
 const sendDraft=useAction(api.outreach.sendApprovedDraft)

 useEffect(()=>{setEdits({})},[selected])
 useEffect(()=>{
  if(!selected){setEmails([]);return}
  setStatus("Checking Gmail for replies…")
  void fetchEmails({leadId:selected}).then(x=>{setEmails(x);setStatus(x.length+" inbound email"+(x.length===1?"":"s")+" found.")}).catch(e=>setStatus(e instanceof Error?e.message:"Could not check Gmail."))
 },[selected,fetchEmails])

 const visible=leads.filter((l:any)=>{
  const q=search.trim().toLowerCase()
  return (!q||[l.name,l.email,l.company,l.request].join(" ").toLowerCase().includes(q))&&(filter==="all"||l.status===filter)
 })
 const makeDraft=async()=>{
  if(!selected)return
  setBusy(true);setStatus("Generating AI follow-up…")
  try{await createDraft({leadId:selected});setStatus("AI follow-up draft created. Review it before sending.")}
  catch(e){setStatus(e instanceof Error?e.message:"Could not create draft.")}finally{setBusy(false)}
 }
 const getEdit=(d:Draft):DraftEdit=>edits[String(d._id)]||{subject:d.subject,bodyText:d.bodyText}
 const changeDraft=(d:Draft,patch:Partial<DraftEdit>)=>{
  const current=getEdit(d)
  setEdits(xs=>({...xs,[String(d._id)]:{...current,...patch}}))
 }
 const save=async(d:Draft)=>{
  const edit=getEdit(d);setBusy(true)
  try{
   await updateDraft({draftId:d._id,subject:edit.subject,bodyText:edit.bodyText})
   setEdits(xs=>{const next={...xs};delete next[String(d._id)];return next})
   setStatus("Draft saved.")
  }catch(e){setStatus(e instanceof Error?e.message:"Could not save draft.")}finally{setBusy(false)}
 }
 const approve=async(id:Id<"outreachDrafts">)=>{
  setBusy(true)
  try{await approveDraft({draftId:id});setStatus("Draft approved. Ready to send.")}
  catch(e){setStatus(e instanceof Error?e.message:"Could not approve draft.")}finally{setBusy(false)}
 }
 const send=async(id:Id<"outreachDrafts">)=>{
  setBusy(true)
  try{await sendDraft({draftId:id});setStatus("Reply sent through Gmail.")}
  catch(e){setStatus(e instanceof Error?e.message:"Could not send reply.")}finally{setBusy(false)}
 }
 const check=()=>{
  if(!selected)return
  setStatus("Checking Gmail…")
  void fetchEmails({leadId:selected}).then(x=>{setEmails(x);setStatus(x.length+" inbound email"+(x.length===1?"":"s")+" found.")}).catch(e=>setStatus(e instanceof Error?e.message:"Could not check Gmail."))
 }

 return <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
  <div className="border-b border-white/10 p-5">
   <p className="text-xs uppercase tracking-[0.18em] text-[#d4af37]">Inbox / Gmail</p><h2 className="mt-1 text-xl font-bold">Conversation Inbox</h2><p className="mt-1 text-sm text-white/40">Replies, CRM context and AI-assisted follow-up in one workspace.</p>
   <div className="mt-4 flex flex-wrap gap-2"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search leads..." className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white"/>
   {["all","new","contacted","qualified","won","lost"].map(x=><button key={x} onClick={()=>setFilter(x)} className={"rounded-full px-3 py-2 text-[10px] capitalize "+(filter===x?"bg-[#d4af37] text-black":"border border-white/10 text-white/45")}>{x}</button>)}</div>
  </div>
  <div className="grid min-h-[600px] md:grid-cols-[320px_1fr]">
   <div className="border-r border-white/10">{!visible.length?<p className="p-5 text-sm text-white/40">No leads match this view.</p>:visible.map((l:any)=><button key={l._id} onClick={()=>setSelected(l._id)} className={"block w-full border-b border-white/10 p-4 text-left "+(selected===l._id?"bg-[#d4af37]/[0.05]":"hover:bg-white/[0.025]")}><div className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{l.name}</span><span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] capitalize text-white/45">{l.status}</span></div><p className="mt-1 truncate text-[11px] text-white/40">{l.company||l.email}</p><p className="mt-2 line-clamp-2 text-xs text-white/55">{l.request}</p></button>)}</div>
   <div className="min-w-0 overflow-y-auto">
    {!selected||!detail?<div className="grid h-full place-items-center p-8 text-sm text-white/35">Select a lead to open the conversation.</div>:<>
     <div className="border-b border-white/10 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{detail.lead.name}</h3><p className="mt-1 text-xs text-white/45">{detail.lead.email}{detail.lead.company?" · "+detail.lead.company:""}</p></div><button onClick={check} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60">Check Gmail</button></div></div>
     <div className="space-y-3 p-5"><p className="text-xs uppercase tracking-[0.16em] text-[#d4af37]">Conversation</p>
      {(detail.messages||[]).map((m:any,i:number)=>{const text=typeof m==="string"?m:String(m.message??"");return text?<article key={i} className="max-w-[88%] rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm"><p className="mb-1 text-[9px] uppercase tracking-wider text-white/30">{m.role==="user"?"Lead":"Jabari Assistant"}</p><p className="whitespace-pre-wrap text-white/75">{text}</p></article>:null})}
      {emails.map((m:any)=><article key={"gmail-"+m.id} className="ml-auto max-w-[88%] rounded-2xl border border-[#d4af37]/20 bg-[#d4af37]/10 px-4 py-3 text-sm"><p className="mb-1 text-[9px] uppercase tracking-wider text-[#d4af37]">Gmail reply</p><p className="font-medium text-white/80">{m.subject||"No subject"}</p><p className="mt-2 whitespace-pre-wrap text-white/65">{m.preview||"(No preview available)"}</p></article>)}
      {!detail.messages?.length&&!emails.length&&<p className="text-sm text-white/35">No conversation messages yet.</p>}
     </div>
     <div className="border-t border-white/10 p-5"><div className="flex items-center justify-between"><p className="text-xs uppercase tracking-[0.16em] text-[#d4af37]">AI follow-up</p><button onClick={()=>void makeDraft()} disabled={busy} className="rounded-lg bg-[#d4af37] px-3 py-2 text-xs font-semibold text-black">{busy?"Working…":"Generate follow-up"}</button></div>
      <div className="mt-3 space-y-3">{(drafts||[]).map(d=>{const edit=getEdit(d);return <div key={d._id} className="rounded-xl border border-white/10 bg-black/20 p-4">
       <input value={edit.subject} onChange={e=>changeDraft(d,{subject:e.target.value})} disabled={d.status!=="draft"} className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white"/>
       <textarea value={edit.bodyText} onChange={e=>changeDraft(d,{bodyText:e.target.value})} disabled={d.status!=="draft"} rows={7} className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs leading-5 text-white"/>
       <div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full border border-white/10 px-2 py-1 text-[9px] capitalize text-white/40">{d.status}</span>
        {d.status==="draft"&&<><button onClick={()=>void save(d)} disabled={busy} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/60">Save</button><button onClick={()=>void approve(d._id)} disabled={busy} className="rounded-lg border border-[#d4af37]/30 px-3 py-2 text-[10px] text-[#d4af37]">Approve</button></>}
        {d.status==="approved"&&<button onClick={()=>void send(d._id)} disabled={busy} className="rounded-lg bg-[#d4af37] px-3 py-2 text-[10px] font-bold text-black">Send via Gmail</button>}
       </div></div>})}</div>
      {status&&<p className="mt-4 text-xs text-white/40">{status}</p>}
     </div>
    </>}
   </div>
  </div>
 </section>
}
