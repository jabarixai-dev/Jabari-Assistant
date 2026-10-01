import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

export function TaskBoard(){
 const {isAuthenticated}=useConvexAuth()
 const rows=useQuery(api.workflowTasks.list,isAuthenticated?{}:"skip")||[]
 const complete=useMutation(api.workflowTasks.complete)
 return <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5"><p className="text-xs uppercase tracking-[.18em] text-[#d4af37]">Workflow tasks</p><h2 className="mt-1 text-xl font-bold">Task Board</h2><div className="mt-4 space-y-2">{!rows.length?<p className="text-sm text-white/40">No workflow tasks yet.</p>:rows.map((x:any)=><div key={x.task._id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-4"><div><p className="text-sm font-medium">{x.task.title}</p><p className="mt-1 text-xs text-white/40">{x.lead?.name||x.lead?.email||"Lead"} · {x.task.detail}</p></div>{x.task.status==="open"&&<button onClick={()=>void complete({taskId:x.task._id as Id<"workflowTasks">})} className="rounded-lg bg-[#d4af37] px-3 py-2 text-xs font-semibold text-black">Complete</button>}</div>)}</div></section>
}
