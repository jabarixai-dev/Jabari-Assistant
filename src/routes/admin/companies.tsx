import { createFileRoute } from "@tanstack/react-router"
import { CompaniesCrm } from "../../components/companies-crm"
export const Route = createFileRoute("/admin/companies")({ component: () => <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">Companies</h1><p className="mt-1 text-sm text-white/45">Keep company records and relationships organized.</p></div><CompaniesCrm /></div> })
