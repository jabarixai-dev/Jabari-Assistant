import { createFileRoute } from "@tanstack/react-router"
import { AgentControls } from "../../components/agent-controls"
import { LandingPages } from "../../components/landing-pages"
import { ReputationManager } from "../../components/reputation-manager"
export const Route = createFileRoute("/admin/settings")({ component: () => <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">Settings</h1><p className="mt-1 text-sm text-white/45">Assistant controls and business tools.</p></div><AgentControls /><ReputationManager /><LandingPages /></div> })
