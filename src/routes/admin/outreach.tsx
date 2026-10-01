import { createFileRoute } from "@tanstack/react-router"
import { OutreachActivity } from "../../components/outreach-activity"
import { CampaignsSequences } from "../../components/campaigns-sequences"
import { FollowUpDashboard } from "../../components/follow-up-dashboard"

export const Route = createFileRoute("/admin/outreach")({
  component: () => <div className="mx-auto max-w-7xl space-y-6">
    <div><h1 className="text-3xl font-bold">Outreach</h1><p className="mt-1 text-sm text-white/45">Manage drafts, outreach activity, follow-ups and campaigns.</p></div>
    <FollowUpDashboard />
    <OutreachActivity />
    <CampaignsSequences />
  </div>
})
