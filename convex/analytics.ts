import { query } from "./_generated/server"
import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"

async function requireOwner(ctx: any) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error("Authentication required.")
  const user = await ctx.db.get(userId)
  if (!user) throw new Error("Owner account not found.")
}

const opportunityStages = ["new","contacted","qualified","proposal","negotiation","won","lost"] as const

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx)
    const statuses = ["new","contacted","qualified","won","lost"] as const
    const byStatus = {new:0,contacted:0,qualified:0,won:0,lost:0}
    for (const status of statuses) {
      byStatus[status] = (await ctx.db.query("leads").withIndex("by_status_and_updatedAt", q => q.eq("status", status)).take(1000)).length
    }
    const [prospects, leadDrafts, prospectDrafts, tasks, contacts, activities, opportunities] = await Promise.all([
      ctx.db.query("prospects").take(2000),
      ctx.db.query("outreachDrafts").take(2000),
      ctx.db.query("prospectOutreachDrafts").take(2000),
      ctx.db.query("workflowTasks").take(2000),
      ctx.db.query("contacts").take(2000),
      ctx.db.query("crmActivities").take(3000),
      ctx.db.query("opportunities").take(2000),
    ])
    const draftCount = (rows: Array<{status:string}>, status:string) => rows.filter(r => r.status === status).length
    return {
      leads: {total: Object.values(byStatus).reduce((a,b)=>a+b,0), byStatus},
      prospects: {
        total: prospects.length,
        qualified: prospects.filter(p=>p.qualificationStatus==="qualified").length,
        review: prospects.filter(p=>p.qualificationStatus==="review").length,
        rejected: prospects.filter(p=>p.qualificationStatus==="rejected").length,
        saved: prospects.filter(p=>p.status==="saved").length,
        ready: prospects.filter(p=>p.contactStatus==="verified" && Boolean(p.contactEmail || p.contactPhone)).length,
        noWebsite: prospects.filter(p=>p.websiteStatus==="no_website").length,
      },
      outreach: {
        drafts: draftCount(leadDrafts,"draft")+draftCount(prospectDrafts,"draft"),
        approved: draftCount(leadDrafts,"approved")+draftCount(prospectDrafts,"approved"),
        sent: draftCount(leadDrafts,"sent")+draftCount(prospectDrafts,"sent"),
        undeliverable: prospectDrafts.filter(d=>d.deliveryStatus==="undeliverable").length,
      },
      workflowTasks: {open: tasks.filter(t=>t.status==="open").length, done: tasks.filter(t=>t.status==="done").length},
      contacts: contacts.length,
      activities: activities.length,
      opportunities: {
        total: opportunities.length,
        openValue: opportunities.filter(o=>o.stage!=="won"&&o.stage!=="lost").reduce((s,o)=>s+o.value,0),
        weightedValue: opportunities.filter(o=>o.stage!=="won"&&o.stage!=="lost").reduce((s,o)=>s+o.value*(o.probability/100),0),
        wonRevenue: opportunities.filter(o=>o.stage==="won").reduce((s,o)=>s+o.value,0),
      },
    }
  },
})

export const revenueReport = query({
  args: {
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const now = Date.now()
    const startAt = args.startAt ?? 0
    const endAt = args.endAt ?? now
    const opportunities = await ctx.db.query("opportunities").take(5000)
    const inPeriod = (timestamp?: number) =>
      typeof timestamp === "number" && timestamp >= startAt && timestamp < endAt

    const open = opportunities.filter(o => o.stage !== "won" && o.stage !== "lost")
    const openWithCloseDate = open.filter(o => inPeriod(o.expectedCloseAt))
    const openPipelineValue = open.reduce((sum,o) => sum + o.value, 0)
    const forecastedRevenue = openWithCloseDate.reduce((sum,o) => sum + o.value * (o.probability / 100), 0)
    const expectedCloseValue = openWithCloseDate.reduce((sum,o) => sum + o.value, 0)
    const expectedCloses = openWithCloseDate.length
    const won = opportunities.filter(o => o.stage === "won" && inPeriod(o.updatedAt))
    const lost = opportunities.filter(o => o.stage === "lost" && inPeriod(o.updatedAt))
    const wonRevenue = won.reduce((sum,o) => sum + o.value, 0)
    const lostValue = lost.reduce((sum,o) => sum + o.value, 0)
    const closedCount = won.length + lost.length
    const conversionRate = closedCount ? (won.length / closedCount) * 100 : 0
    const averageDealValue = closedCount ? (wonRevenue + lostValue) / closedCount : 0
    const newDeals = opportunities.filter(o => inPeriod(o.createdAt)).length
    const undatedOpenValue = open.filter(o => typeof o.expectedCloseAt !== "number").reduce((sum,o) => sum + o.value, 0)
    const stages = opportunityStages.map(stage => {
      const rows = opportunities.filter(o => o.stage === stage)
      const periodRows = stage === "won" || stage === "lost"
        ? rows.filter(o => inPeriod(o.updatedAt))
        : rows.filter(o => inPeriod(o.expectedCloseAt))
      return {
        stage,
        count: periodRows.length,
        value: periodRows.reduce((sum,o) => sum + o.value, 0),
        weightedValue: periodRows.reduce((sum,o) => sum + o.value * (o.probability / 100), 0),
      }
    })
    return {startAt,endAt,openPipelineValue,forecastedRevenue,expectedCloseValue,expectedCloses,wonRevenue,wonDeals:won.length,lostDeals:lost.length,conversionRate,averageDealValue,newDeals,undatedOpenValue,stages}
  },
})

export const commandCenter = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx)
    const now=Date.now()
    const day=24*60*60*1000
    const [leads,opps,tasks,appointments,invoices,activities]=await Promise.all([
      ctx.db.query("leads").take(3000),
      ctx.db.query("opportunities").take(3000),
      ctx.db.query("workflowTasks").take(3000),
      ctx.db.query("appointments").take(1000),
      ctx.db.query("invoices").take(2000),
      ctx.db.query("crmActivities").take(3000),
    ])
    const todayStart=new Date(); todayStart.setHours(0,0,0,0)
    const ts=todayStart.getTime()
    const overdueTasks=tasks.filter(t=>t.status==="open"&&typeof t.dueAt==="number"&&t.dueAt<now)
    const dueToday=tasks.filter(t=>t.status==="open"&&typeof t.dueAt==="number"&&t.dueAt>=ts&&t.dueAt<ts+day)
    const upcomingAppointments=appointments.filter(a=>a.status!=="cancelled"&&a.startAt>=now&&a.startAt<now+7*day).sort((a,b)=>a.startAt-b.startAt).slice(0,10)
    const pendingInvoices=invoices.filter(i=>i.status==="sent")
    const unpaidValue=pendingInvoices.reduce((s,i)=>s+i.total,0)
    const openOpps=opps.filter(o=>o.stage!=="won"&&o.stage!=="lost")
    const recentLeads=leads.filter(l=>l.updatedAt>=now-7*day).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8)
    const recentActivities=activities.sort((a,b)=>b.createdAt-a.createdAt).slice(0,10)
    return {now,counts:{leads:leads.filter(l=>l.status!=="won"&&l.status!=="lost").length,openOpportunities:openOpps.length,overdueTasks:overdueTasks.length,dueToday:dueToday.length,appointmentsThisWeek:upcomingAppointments.length,pendingInvoices:pendingInvoices.length},values:{openPipeline:openOpps.reduce((s,o)=>s+o.value,0),weightedPipeline:openOpps.reduce((s,o)=>s+o.value*(o.probability/100),0),unpaidInvoices:unpaidValue},recentLeads,upcomingAppointments,recentActivities}
  }
})
