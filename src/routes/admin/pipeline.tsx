import { createFileRoute } from "@tanstack/react-router"
import { OpportunityPipeline } from "../../components/opportunity-pipeline"
import { SalesPipeline } from "../../components/sales-pipeline"
export const Route = createFileRoute("/admin/pipeline")({ component: () => <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">Pipeline</h1><p className="mt-1 text-sm text-white/45">Track opportunities from new lead to won revenue.</p></div><OpportunityPipeline /><SalesPipeline /></div> })
