import { createFileRoute } from "@tanstack/react-router"
import { ConvexConversationsInbox } from "../../components/convex-conversations-inbox"

export const Route = createFileRoute("/admin/conversations")({
 component: () => <div className="mx-auto max-w-7xl space-y-6"><div><h1 className="text-3xl font-bold">Conversations</h1><p className="mt-1 text-sm text-white/45">Manage prospect replies and AI-assisted follow-ups.</p></div><ConvexConversationsInbox /></div>,
})
