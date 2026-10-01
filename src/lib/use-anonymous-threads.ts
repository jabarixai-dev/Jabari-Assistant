import { useEffect, useState } from "react"
import { useAction, useMutation, useQuery } from "convex/react"

import { api } from "../../convex/_generated/api"
import {
  saveAnonymousChatCapability,
  saveLastActiveThreadId,
  useAnonymousChatCapability,
  useLastActiveThreadId,
} from "./anonymous-chat-state"

type Thread = {
  _id: string
  _creationTime: number
  title: string
  updatedAt: number
}

export function useAnonymousThreads() {
  const storedCapability = useAnonymousChatCapability()
  const savedThreadId = useLastActiveThreadId()
  const [capability, setCapability] = useState<string | null>(storedCapability)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    setCapability(storedCapability)
  }, [storedCapability])

  const rows = useQuery(
    api.agentChat.listThreads,
    capability ? { capability } : "skip",
  ) as Thread[] | undefined

  const createSession = useAction(api.anonymousSession.create)
  const createNewThread = useMutation(api.agentChat.createNewThread)

  const threads = rows ?? []

  const hasThread = (value: string | null): value is string =>
    Boolean(value && threads.some((thread) => thread._id === value))

  const activeThreadId = hasThread(selectedThreadId)
    ? selectedThreadId
    : hasThread(savedThreadId)
      ? savedThreadId
      : (threads[0]?._id ?? null)

  const selectThread = (threadId: string) => {
    setSelectedThreadId(threadId)
    saveLastActiveThreadId(threadId)
  }

  const createThread = async () => {
    if (isCreating) return null
    setIsCreating(true)
    try {
      let nextCapability = capability
      if (!nextCapability) {
        nextCapability = await createSession({})
        saveAnonymousChatCapability(nextCapability)
        setCapability(nextCapability)
      }

      const threadId = await createNewThread({ capability: nextCapability })
      selectThread(threadId)
      return threadId
    } finally {
      setIsCreating(false)
    }
  }

  return {
    activeThreadId,
    capability,
    createThread,
    isCreating,
    selectThread,
    threads,
  }
}
