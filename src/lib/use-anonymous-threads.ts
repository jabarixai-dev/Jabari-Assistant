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

  const hasThread = (id: string | null) =>
    Boolean(id && threads.some((thread) => thread._id === id))

  /*
   * Only use a thread that actually exists in the current
   * Convex session. This prevents stale localStorage IDs
   * from being submitted to agentChat.submitMessage().
   */
  const activeThreadId =
    hasThread(selectedThreadId)
      ? selectedThreadId
      : hasThread(savedThreadId)
        ? savedThreadId
        : threads[0]?._id ?? null

  /*
   * If the saved thread no longer exists, remove it from
   * localStorage so it cannot be reused later.
   */
  useEffect(() => {
    if (
      rows !== undefined &&
      savedThreadId !== null &&
      !threads.some((thread) => thread._id === savedThreadId)
    ) {
      saveLastActiveThreadId(null)
      setSelectedThreadId(null)
    }
  }, [rows, savedThreadId, threads])

  const selectThread = (threadId: string) => {
    if (!threads.some((thread) => thread._id === threadId)) {
      return
    }

    setSelectedThreadId(threadId)
    saveLastActiveThreadId(threadId)
  }

  const createThread = async () => {
    if (isCreating) return null

    setIsCreating(true)

    try {
      let nextCapability = capability

      /*
       * Create a completely new anonymous session when there
       * is no valid capability.
       */
      if (!nextCapability) {
        nextCapability = await createSession({})

        saveAnonymousChatCapability(nextCapability)
        setCapability(nextCapability)
      }

      const threadId = await createNewThread({
        capability: nextCapability,
      })

      setSelectedThreadId(threadId)
      saveLastActiveThreadId(threadId)

      return threadId
    } catch (error) {
      /*
       * If the stored capability is invalid/expired, clear it.
       * The next attempt will create a fresh anonymous session.
       */
      const message =
        error instanceof Error ? error.message : String(error)

      if (
        message.toLowerCase().includes("chat session not found") ||
        message.toLowerCase().includes("session")
      ) {
        saveAnonymousChatCapability(null)
        saveLastActiveThreadId(null)
        setCapability(null)
        setSelectedThreadId(null)
      }

      throw error
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
