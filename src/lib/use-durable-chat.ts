import { useMemo } from "react"
import { useChat } from "@ai-sdk/react"
import { useConvex, useQuery } from "convex/react"
import type { UIMessage } from "ai"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { ConvexChatTransport } from "./convex-chat-transport"
import { mergeDurableMessages } from "./merge-durable-messages"

export function useDurableChat({
  capability,
  threadId,
}: {
  capability: string
  threadId: string
}) {
  const client = useConvex()

  const persistedMessages = useQuery(
    api.agentChat.listMessages,
    {
      capability,
      threadId,
    },
  ) as UIMessage[] | undefined

  const transport = useMemo(
    () =>
      new ConvexChatTransport(
        client,
        capability,
      ),
    [client, capability],
  )

  const chat = useChat({
    id: threadId,
    transport,
  })

  const messages = useMemo(
    () =>
      mergeDurableMessages(
        persistedMessages ?? [],
        chat.messages,
      ),
    [
      persistedMessages,
      chat.messages,
    ],
  )

  const isBusy =
    chat.status === "submitted" ||
    chat.status === "streaming"

  return {
    ...chat,
    messages,
    error: chat.error ?? null,
    isBusy,
    historyLoading:
      persistedMessages === undefined,
    threadId:
      threadId as Id<"chatThreads">,
  }
}
