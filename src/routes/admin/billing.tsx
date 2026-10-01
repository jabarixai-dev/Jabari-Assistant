import { createFileRoute } from "@tanstack/react-router"
import { BillingManager } from "../../components/billing-manager"
export const Route = createFileRoute("/admin/billing")({ component: () => <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">Billing</h1><p className="mt-1 text-sm text-white/45">Invoices and payment activity.</p></div><BillingManager /></div> })
