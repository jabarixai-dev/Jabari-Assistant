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

  const [capability, setCapability] = useState<string | null>(
    storedCapability,
  )
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    null,
  )
  const [isCreating, setIsCreating] = useState(false)

  /*
   * Keep the in-memory capability synchronized with localStorage.
   */
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

  /*
   * Only use a thread that actually exists in the current
   * Convex session. This prevents stale localStorage IDs
   * from being used.
   */
  const hasThread = (value: string | null): value is string =>
    Boolean(value && threads.some((thread) => thread._id === value))

  const activeThreadId = hasThread(selectedThreadId)
    ? selectedThreadId
    : hasThread(savedThreadId)
      ? savedThreadId
      : (threads[0]?._id ?? null)

  /*
   * If the saved thread no longer exists, clear it immediately.
   */
  useEffect(() => {
    if (
      rows !== undefined &&
      savedThreadId &&
      !threads.some((thread) => thread._id === savedThreadId)
    ) {
      saveLastActiveThreadId(null)
      setSelectedThreadId(null)
    }
  }, [rows, savedThreadId, threads])

  /*
   * Select an existing valid conversation.
   */
  const selectThread = (threadId: string) => {
    if (!threads.some((thread) => thread._id === threadId)) {
      return
    }

    setSelectedThreadId(threadId)
    saveLastActiveThreadId(threadId)
  }

  /*
   * Create a completely valid session + conversation.
   */
  const createThread = async () => {
    if (isCreating) return null

    setIsCreating(true)

    try {
      let nextCapability = capability

      /*
       * No valid capability yet:
       * create a fresh anonymous session.
       */
      if (!nextCapability) {
        nextCapability = await createSession({})

        saveAnonymousChatCapability(nextCapability)
        setCapability(nextCapability)
      }

      /*
       * Create the conversation under that exact capability.
       */
      const threadId = await createNewThread({
        capability: nextCapability,
      })

      setSelectedThreadId(threadId)
      saveLastActiveThreadId(threadId)

      return threadId
    } catch (error) {
      /*
       * If the stored anonymous session has become invalid,
       * clear both pieces of local state so the next attempt
       * starts completely fresh.
       */
      const message =
        error instanceof Error ? error.message : String(error)

      if (
        message.includes("Chat session not found") ||
        message.includes("Session not found") ||
        message.includes("Conversation not found")
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
