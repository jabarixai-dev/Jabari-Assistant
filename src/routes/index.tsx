import { createFileRoute } from "@tanstack/react-router"

import { NoAuthChatShell } from "../components/no-auth-chat-shell"

export const Route = createFileRoute("/")({
  component: NoAuthChatShell,
})
