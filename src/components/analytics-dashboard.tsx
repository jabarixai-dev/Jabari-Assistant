import { useConvexAuth, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
function Card({label,value,hint}:{label:string,value:string|number,hint?:string}){return <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div>{hint&&<div className="mt-1 text-xs text-white/45">{hint}</div>}</div>}
const money=(n:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:0}).format(n)
const pct=(n:number)=>n.toFixed(1)+"%"
export function AnalyticsDashboard(){
 const {isAuthenticated,isLoading}=useConvexAuth()
 const data=useQuery(api.analytics.dashboard,isAuthenticated?{}:"skip")
 const report=useQuery(api.analytics.revenueReport,isAuthenticated?{}:"skip")
 if(isLoading||!isAuthenticated)return <section className="rounded-3xl border border-white/10 bg-black/30 p-5 text-sm text-white/50">Checking authentication…</section>
 if(data===undefined||report===undefined)return <section className="rounded-3xl border border-white/10 bg-black/30 p-5 text-sm text-white/50">Loading analytics…</section>
 const stages=[["new","New"],["contacted","Contacted"],["qualified","Qualified"],["won","Won"],["lost","Lost"]] as const
 const total=Math.max(1,data.leads.total)
 return <section className="space-y-5 rounded-3xl border border-white/10 bg-black/30 p-5">
  <div><div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d8b45a]">Analytics</div><h2 className="mt-1 text-xl font-semibold">Business performance & revenue forecast</h2><p className="mt-1 text-sm text-white/50">Live CRM reporting from your Opportunities pipeline.</p></div>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
   <Card label="Forecasted revenue" value={money(report.forecastedRevenue)} hint={report.expectedCloses+" expected closes"}/>
   <Card label="Won revenue" value={money(report.wonRevenue)} hint={report.wonDeals+" won deals"}/>
   <Card label="Conversion rate" value={pct(report.conversionRate)} hint={report.wonDeals+" won / "+(report.wonDeals+report.lostDeals)+" closed"}/>
   <Card label="Average closed deal" value={money(report.averageDealValue)}/>
  </div>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
   <Card label="Open pipeline" value={money(report.openPipelineValue)}/><Card label="Expected close value" value={money(report.expectedCloseValue)}/><Card label="New opportunities" value={report.newDeals}/><Card label="Undated open value" value={money(report.undatedOpenValue)}/>
  </div>
  <div className="grid gap-5 lg:grid-cols-2">
   <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><h3 className="text-sm font-semibold">Lead pipeline</h3><div className="mt-4 space-y-3">{stages.map(([key,label])=>{const count=data.leads.byStatus[key];return <div key={key}><div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="text-white/45">{count}</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#d8b45a]" style={{width:Math.round(count/total*100)+"%"}}/></div></div>})}</div></div>
   <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><h3 className="text-sm font-semibold">Prospect funnel</h3><div className="mt-4 space-y-3">{[["Found",data.prospects.total],["Qualified",data.prospects.qualified],["Saved",data.prospects.saved],["Ready for outreach",data.prospects.ready]].map(([label,count])=><div key={String(label)} className="flex justify-between border-b border-white/5 py-2 text-xs"><span>{label}</span><span className="text-white/45">{count}</span></div>)}</div></div>
  </div>
  <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><h3 className="text-sm font-semibold">Revenue by opportunity stage</h3><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead><tr className="border-b border-white/10 text-white/35"><th className="p-2">Stage</th><th className="p-2">Deals</th><th className="p-2">Value</th><th className="p-2">Weighted</th></tr></thead><tbody>{report.stages.map((s:any)=><tr key={s.stage} className="border-b border-white/5"><td className="p-2 capitalize">{s.stage}</td><td className="p-2 text-white/50">{s.count}</td><td className="p-2">{money(s.value)}</td><td className="p-2 text-[#d4af37]">{money(s.weightedValue)}</td></tr>)}</tbody></table></div></div>
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Card label="Contacts" value={data.contacts}/><Card label="No-website prospects" value={data.prospects.noWebsite}/><Card label="Outreach drafts" value={data.outreach.drafts}/><Card label="CRM activities" value={data.activities}/></div>
 </section>
}
