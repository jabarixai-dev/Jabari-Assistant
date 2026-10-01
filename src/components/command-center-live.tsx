import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"

export function CommandCenterLive(){
  const data=useQuery(api.analytics.commandCenter,{})
  if(!data)return <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5 text-sm text-white/45">Loading live business metrics…</div>
  const cards=[
    ["Open leads",data.counts.leads],
    ["Open opportunities",data.counts.openOpportunities],
    ["Overdue tasks",data.counts.overdueTasks],
    ["Appointments · 7d",data.counts.appointmentsThisWeek],
    ["Pending invoices",data.counts.pendingInvoices],
  ]
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([label,value])=><div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><p className="text-xs text-white/45">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div>
    <div className="grid gap-4 md:grid-cols-3">
      <Metric title="Open pipeline" value={money(data.values.openPipeline)}/>
      <Metric title="Weighted pipeline" value={money(data.values.weightedPipeline)}/>
      <Metric title="Unpaid invoices" value={money(data.values.unpaidInvoices)}/>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><h2 className="font-semibold">Upcoming appointments</h2><div className="mt-4 space-y-3">{data.upcomingAppointments.length?data.upcomingAppointments.map(a=><div key={String(a._id)} className="rounded-xl border border-white/10 p-3"><p className="font-medium">{a.title}</p><p className="mt-1 text-xs text-white/45">{new Date(a.startAt).toLocaleString()} · {a.status}</p></div>):<p className="text-sm text-white/40">No upcoming appointments.</p>}</div></section>
      <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><h2 className="font-semibold">Attention</h2><div className="mt-4 space-y-3"><Attention label="Overdue tasks" value={data.counts.overdueTasks}/><Attention label="Tasks due today" value={data.counts.dueToday}/><Attention label="Unpaid invoice value" value={money(data.values.unpaidInvoices)}/></div></section>
    </div>
  </div>
}
function Metric({title,value}:{title:string,value:string}){return <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><p className="text-xs text-white/45">{title}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>}
function Attention({label,value}:{label:string,value:string|number}){return <div className="flex items-center justify-between rounded-xl border border-white/10 p-3"><span className="text-sm">{label}</span><span className="font-semibold">{value}</span></div>}
function money(n:number){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(n)}
