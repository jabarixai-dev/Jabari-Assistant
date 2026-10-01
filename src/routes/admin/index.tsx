import { createFileRoute } from "@tanstack/react-router"
import { AnalyticsDashboard } from "../../components/analytics-dashboard"
import { UnifiedFeed } from "../../components/unified-feed"
import { GlobalCrmSearch } from "../../components/global-crm-search"
import { CommandCenterLive } from "../../components/command-center-live"

export const Route = createFileRoute("/admin/")({ component: OverviewPage })

function OverviewPage() {
  return <div className="mx-auto max-w-7xl space-y-6">
    <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af37]">Workspace</p><h1 className="mt-2 text-3xl font-bold">Command Center</h1><p className="mt-1 text-sm text-white/45">Your business at a glance. Use the sidebar to open each workspace as its own page.</p></div>
    <GlobalCrmSearch />
    <CommandCenterLive />
    <AnalyticsDashboard />
    <UnifiedFeed />
  </div>
}
