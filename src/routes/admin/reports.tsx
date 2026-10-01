import { createFileRoute } from "@tanstack/react-router"
import { AnalyticsDashboard } from "../../components/analytics-dashboard"
export const Route = createFileRoute("/admin/reports")({ component: () => <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">Reports</h1><p className="mt-1 text-sm text-white/45">Monitor pipeline, outreach and business activity.</p></div><AnalyticsDashboard /></div> })
