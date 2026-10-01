import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"

export const Route=createFileRoute("/review/$id")({component:ReviewPage})

function ReviewPage(){
  const {id}=Route.useParams()
  const requestId=id as any
  const request=useQuery(api.reviews.getPublic,{id:requestId})
  const submit=useMutation(api.reviews.submit)
  const [rating,setRating]=useState(5),[feedback,setFeedback]=useState(""),[done,setDone]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("")
  if(request===undefined)return <main className="min-h-screen grid place-items-center bg-[#0b0b0b] text-white">Loading…</main>
  if(!request)return <main className="min-h-screen grid place-items-center bg-[#0b0b0b] text-white"><div className="max-w-md p-8 text-center"><h1 className="text-2xl font-bold">Review unavailable</h1><p className="mt-2 text-white/50">This review link is no longer active.</p></div></main>
  if(done)return <main className="min-h-screen grid place-items-center bg-[#0b0b0b] text-white"><div className="max-w-md p-8 text-center"><h1 className="text-2xl font-bold">Thank you.</h1><p className="mt-2 text-white/50">Your feedback has been received by Jabari Tech.</p></div></main>
  async function send(){setBusy(true);setError("");try{await submit({id:requestId,rating,feedback});setDone(true)}catch(e){setError(e instanceof Error?e.message:"Unable to submit review.")}finally{setBusy(false)}}
  return <main className="min-h-screen bg-[#0b0b0b] px-4 py-12 text-white"><div className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-white/[.04] p-7"><p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af37]">Jabari Tech</p><h1 className="mt-3 text-3xl font-bold">How did we do?</h1><p className="mt-2 text-white/55">Hi {request.name}, we’d appreciate a quick review of your experience.</p><div className="mt-7"><p className="text-sm font-medium">Your rating</p><div className="mt-3 flex gap-2">{[1,2,3,4,5].map(n=><button type="button" key={n} onClick={()=>setRating(n)} className={`h-11 w-11 rounded-xl border ${rating>=n?"border-[#d4af37] bg-[#d4af37]/20":"border-white/10 bg-white/[.03]"}`}>{n}</button>)}</div></div><textarea value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="Tell us about your experience…" className="mt-6 min-h-32 w-full rounded-xl border border-white/10 bg-black/20 p-4 outline-none" /><button disabled={busy} onClick={send} className="mt-4 w-full rounded-xl bg-white px-4 py-3 font-semibold text-black disabled:opacity-50">{busy?"Sending…":"Submit review"}</button>{error&&<p className="mt-3 text-sm text-red-300">{error}</p>}</div></main>
}
