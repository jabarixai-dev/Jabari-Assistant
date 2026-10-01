import { useEffect, useState } from "react"
import { neonAuthClient } from "../lib/neon-auth"
import { OwnerSignIn } from "../components/owner-sign-in"
import { ProspectResearch } from "../components/prospect-research"
import { OutreachActivity } from "../components/outreach-activity"
import { SalesPipeline } from "../components/sales-pipeline"
import { ContactsCrm } from "../components/contacts-crm"
import { WorkflowBuilder } from "../components/workflow-builder"
import { UnifiedFeed } from "../components/unified-feed"
import { AgentControls } from "../components/agent-controls"
import { LeadCopilot } from "../components/lead-copilot"
import { NeonOutreachPanel } from "../components/neon-outreach-panel"
import { AnalyticsDashboard } from "../components/analytics-dashboard"
import { TaskBoard } from "../components/task-board"
import { AppointmentsCalendar } from "../components/appointments-calendar"
import { CompaniesCrm } from "../components/companies-crm"
import { GlobalCrmSearch } from "../components/global-crm-search"
import { ConversationsInbox } from "../components/conversations-inbox"
import { OpportunityPipeline } from "../components/opportunity-pipeline"
import { LeadCapture } from "../components/lead-capture"
import { BookingManager } from "../components/booking-manager"
import { LandingPages } from "../components/landing-pages"
import { ReputationManager } from "../components/reputation-manager"
import { BillingManager } from "../components/billing-manager"
import { CampaignsSequences } from "../components/campaigns-sequences"
import { neonFetch } from "../lib/neon-api"
import { AgentActionCenter } from "../components/agent-action-center"

const statuses = ["new", "contacted", "qualified", "won", "lost"] as const
type LeadStatus = (typeof statuses)[number]

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

const workspaceSections=[
  ["overview","Overview"],["contacts","Contacts"],["companies","Companies"],["activity","Activity"],["pipeline","Pipeline"],["research","Prospects"],["outreach","Outreach"],["forms","Forms"],["booking","Booking"],["pages","Pages"],["reputation","Reputation"],["billing","Billing"],["tasks","Tasks"],["workflows","Workflows"],["analytics","Analytics"],["calendar","Calendar"],["agent","Agent Controls"],["actions","Action Center"],
]
function WorkspaceNav(){
 return <nav className="sticky top-0 z-30 -mx-1 mb-6 overflow-x-auto rounded-2xl border border-white/10 bg-[#0b0b0b]/95 p-2 backdrop-blur"><div className="flex min-w-max gap-1">{workspaceSections.map(([id,label])=><button key={id} onClick={()=>document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"})} className="rounded-lg px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/45 hover:bg-white/5 hover:text-white">{label}</button>)}</div></nav>
}

function Dashboard() {
  const auth = neonAuthClient
  const [metrics,setMetrics] = useState<any>(undefined)
  useEffect(() => { void neonFetch<any>("/api/crm?resource=analytics-dashboard").then((r) => setMetrics({prospects:r.prospects?.total ?? 0, analyzed:r.prospects?.analyzed ?? 0, drafts:r.outreach?.drafts ?? 0, approved:r.outreach?.approved ?? 0, sent:r.outreach?.sent ?? 0})).catch(() => setMetrics(undefined)) }, [])
  type NeonLead = { id: string; name: string; email: string; company?: string | null; request: string; budget?: string | null; timeline?: string | null; status: LeadStatus; updated_at: number }
  type NeonLeadDetail = { lead: NeonLead; messages: Array<{ id?: string; role?: string; message?: string; parts?: Array<{ type?: string; text?: string }> }>; contact?: unknown; activities: unknown[] }
  const [leads, setLeads] = useState<NeonLead[] | undefined>(undefined)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NeonLeadDetail | null | undefined>(undefined)
  const [leadError, setLeadError] = useState("")
  const loadLeads = async () => {
    try { setLeadError(""); const result = await neonFetch<{ ok: boolean; leads: NeonLead[] }>("/api/leads?resource=leads"); setLeads(result.leads) }
    catch (error) { setLeadError(error instanceof Error ? error.message : "Could not load leads.") }
  }
  useEffect(() => { void loadLeads() }, [])
  useEffect(() => {
    if (!selectedLeadId) { setDetail(undefined); return }
    setDetail(undefined)
    void neonFetch<NeonLeadDetail>("/api/leads?resource=lead&id=" + encodeURIComponent(selectedLeadId)).then(setDetail).catch((error) => setLeadError(error instanceof Error ? error.message : "Could not load lead detail."))
  }, [selectedLeadId])
  const handleStatus = async (leadId: string, status: LeadStatus) => {
    await neonFetch("/api/leads?resource=lead-status&id=" + encodeURIComponent(leadId), { method: "PATCH", body: JSON.stringify({ status }) })
    await loadLeads()
    setDetail((current) => current && current.lead.id === leadId ? { ...current, lead: { ...current.lead, status } } : current)
  }
  return (
    <main className="min-h-screen bg-[#080808] text-white">
      <header className="border-b border-white/10 bg-black/80 px-5 py-5"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d4af37]">Jabari Tech</p><h1 className="mt-1 text-2xl font-bold">Command Center</h1><p className="mt-1 text-sm text-white/45">Private lead and outreach workspace</p></div><button onClick={() => void auth?.signOut()} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/5">Sign out</button></div></header>
      <section className="mx-auto max-w-6xl px-5 py-8"><GlobalCrmSearch /><div id="overview" className="scroll-mt-24"><WorkspaceNav />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <button type="button" onClick={() => document.getElementById("captured-leads")?.scrollIntoView({behavior:"smooth",block:"start"})} className="rounded-2xl border border-[#d4af37]/30 bg-[#d4af37]/[0.06] p-5 text-left transition hover:bg-[#d4af37]/[0.1]" aria-label="View captured leads"><p className="text-sm text-white/50">Captured leads</p><p className="mt-2 text-3xl font-bold">{leads?.length ?? "—"}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-[#d4af37]/70">View leads →</p></button>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs text-white/50">Prospects</p><p className="mt-2 text-2xl font-bold">{metrics?.prospects ?? "—"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs text-white/50">Analyzed</p><p className="mt-2 text-2xl font-bold">{metrics?.analyzed ?? "—"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs text-white/50">Drafts</p><p className="mt-2 text-2xl font-bold">{metrics?.drafts ?? "—"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs text-white/50">Approved</p><p className="mt-2 text-2xl font-bold text-[#d4af37]">{metrics?.approved ?? "—"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"><p className="text-xs text-white/50">Sent</p><p className="mt-2 text-2xl font-bold">{metrics?.sent ?? "—"}</p></div>
        </div>
        <div id="captured-leads" className="mt-8 scroll-mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold">Captured leads</h2><p className="mt-1 text-xs text-white/40">Tap a lead to inspect the conversation and update its status.</p></div>
          {leads === undefined ? <p className="p-5 text-sm text-white/50">Loading leads…</p> : leads.length === 0 ? <div className="p-8 text-center text-sm text-white/50">No qualified enquiries yet.</div> : <div className="divide-y divide-white/10">{leads.map((lead) => <button key={lead.id} type="button" onClick={() => setSelectedLeadId(lead.id)} className="block w-full text-left transition hover:bg-white/[0.035]"><article className="grid gap-3 p-5 md:grid-cols-[1fr_1fr_180px]"><div><h3 className="font-semibold">{lead.name}</h3><p className="text-sm text-white/50">{lead.email}{lead.company ? " · " + lead.company : ""}</p><p className="mt-1 text-xs text-white/35">{formatDate(lead.updated_at)}</p></div><div><p className="text-sm text-white/80">{lead.request}</p><p className="mt-1 text-xs text-white/40">{lead.budget || "Budget not provided"} · {lead.timeline || "Timeline not provided"}</p></div><div className="flex items-start justify-between gap-3 md:justify-end"><span className="inline-flex rounded-full border border-[#d4af37]/30 px-3 py-1 text-xs capitalize text-[#d4af37]">{lead.status}</span><span className="text-xs text-white/30">View →</span></div></article></button>)}</div>}
        </div>
        <div id="conversations" className="scroll-mt-24"><ConversationsInbox onOpenLead={setSelectedLeadId} /></div>
        <div id="contacts" className="scroll-mt-24"><ContactsCrm /></div><div id="deals" className="scroll-mt-24"><OpportunityPipeline /></div><div id="companies" className="scroll-mt-24"><CompaniesCrm /></div><div id="agent" className="scroll-mt-24"><AgentControls /></div><div id="actions" className="scroll-mt-24"><AgentActionCenter /></div><div id="analytics" className="scroll-mt-24"><AnalyticsDashboard /></div><div id="tasks" className="scroll-mt-24"><TaskBoard /></div><div id="activity" className="scroll-mt-24"><UnifiedFeed /></div><div id="workflows" className="scroll-mt-24"><WorkflowBuilder /></div><div id="pipeline" className="scroll-mt-24"><SalesPipeline /></div><div id="research" className="scroll-mt-24"><ProspectResearch /></div><div id="outreach" className="scroll-mt-24"><OutreachActivity /></div>
        <LeadCapture /><BookingManager /><LandingPages /><ReputationManager /><BillingManager /><div id="calendar" className="scroll-mt-24"><AppointmentsCalendar /></div>
      </div></section>
      {selectedLeadId && <div className="fixed inset-0 z-50 bg-black/75 p-3 sm:p-6" onClick={() => setSelectedLeadId(null)}><div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5"><div><p className="text-xs uppercase tracking-[0.18em] text-[#d4af37]">Lead detail</p><h2 className="mt-1 text-xl font-bold">{detail?.lead?.name ?? "Loading…"}</h2>{detail?.lead && <p className="mt-1 text-sm text-white/50">{detail.lead.email}{detail.lead.company ? " · " + detail.lead.company : ""}</p>}</div><button type="button" onClick={() => setSelectedLeadId(null)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5">Close</button></div>
        {detail === undefined ? <div className="p-6 text-sm text-white/50">Loading lead…</div> : detail === null ? <div className="p-6 text-sm text-white/50">Lead not found.</div> : <>
          <LeadCopilot leadId={detail.lead.id} /><NeonOutreachPanel leadId={detail.lead.id} />
          <div className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-3"><div><p className="text-xs text-white/40">Request</p><p className="mt-1 text-sm">{detail.lead.request}</p></div><div><p className="text-xs text-white/40">Budget</p><p className="mt-1 text-sm">{detail.lead.budget || "Not provided"}</p></div><div><p className="text-xs text-white/40">Timeline</p><p className="mt-1 text-sm">{detail.lead.timeline || "Not provided"}</p></div></div>
          <div className="border-b border-white/10 p-5"><p className="mb-2 text-xs uppercase tracking-[0.16em] text-white/40">Lead status</p><div className="flex flex-wrap gap-2">{statuses.map((status) => <button key={status} type="button" onClick={() => void handleStatus(detail.lead.id,status)} className={"rounded-lg border px-3 py-2 text-xs capitalize transition "+(detail.lead.status===status?"border-[#d4af37] bg-[#d4af37]/10 text-[#d4af37]":"border-white/10 text-white/55 hover:bg-white/5")}>{status}</button>)}</div></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5"><p className="mb-4 text-xs uppercase tracking-[0.16em] text-white/40">Visitor conversation</p><div className="space-y-3">{detail.messages.length===0 ? <p className="text-sm text-white/40">No conversation messages found.</p> : detail.messages.map((message,index) => { const text=message.message ?? (message.parts ?? []).filter(part=>part.type==="text").map(part=>part.text ?? "").join(""); if(!text) return null; return <div key={message.id ?? String(index)} className={"max-w-[92%] rounded-2xl border px-4 py-3 text-sm "+(message.role==="user"?"ml-auto border-[#d4af37]/20 bg-[#d4af37]/10":"border-white/10 bg-white/[0.04]")}><p className="mb-1 text-[10px] uppercase tracking-wider text-white/35">{message.role==="user"?"Visitor":"Jabari Assistant"}</p><p className="whitespace-pre-wrap text-white/80">{text}</p></div>})}</div></div>
        </>}
      </div></div>}
    </main>
  )
}

export function CommandCenter() {
  const auth = neonAuthClient
  if (!auth) return <OwnerSignIn />
  const session = auth.useSession()
  if (session.isPending) return <div className="min-h-screen grid place-items-center bg-[#080808] text-white">Checking secure session…</div>
  const userEmail = session.data?.user?.email?.toLowerCase()
  if (!session.data) return <OwnerSignIn />
  if (userEmail !== "jabari.xai@gmail.com") return <div className="min-h-screen grid place-items-center bg-[#080808] text-white px-5"><div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-7"><h1 className="text-xl font-bold">Private workspace</h1><p className="mt-2 text-sm text-white/60">This account is not authorized for the Jabari Tech Command Center.</p><button onClick={() => void auth.signOut()} className="mt-5 rounded-lg border border-white/10 px-4 py-2 text-sm">Sign out</button></div></div>
  return <Dashboard />
}
