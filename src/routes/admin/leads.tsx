import { createFileRoute } from "@tanstack/react-router"
import { LeadCapture } from "../../components/lead-capture"
import { ProspectResearch } from "../../components/prospect-research"

export const Route = createFileRoute("/admin/leads")({ component: LeadsPage })
function LeadsPage() { return <div className="mx-auto max-w-7xl space-y-6"><PageTitle title="Leads" text="Capture, research and qualify new business opportunities."/><LeadCapture /><ProspectResearch /></div> }
function PageTitle({title,text}:{title:string;text:string}) { return <div><h1 className="text-3xl font-bold">{title}</h1><p className="mt-1 text-sm text-white/45">{text}</p></div> }
