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

  const [selectedThreadId, setSelectedThreadId] =
    useState<string | null>(null)

  const [isCreating, setIsCreating] = useState(false)

  /*
   * Keep the React capability synchronized with localStorage.
   */
  useEffect(() => {
    setCapability(storedCapability)
  }, [storedCapability])

  /*
   * A capability identifies the anonymous session.
   *
   * If the capability changes, the previously selected thread
   * must not be reused because it may belong to another session.
   */
  useEffect(() => {
    setSelectedThreadId(null)
    saveLastActiveThreadId(null)
  }, [capability])

  /*
   * Ask Convex for the threads belonging to the CURRENT
   * anonymous capability.
   */
  const rows = useQuery(
    api.agentChat.listThreads,
    capability ? { capability } : "skip",
  ) as Thread[] | undefined

  const createSession = useAction(api.anonymousSession.create)

  const createNewThread = useMutation(
    api.agentChat.createNewThread,
  )

  /*
   * Do not treat an unresolved Convex query as an empty
   * confirmed list. We need to know that the query has loaded
   * before selecting a thread.
   */
  const threads = rows ?? []

  const isThreadValid = (id: string | null) => {
    if (!id || rows === undefined) {
      return false
    }

    return threads.some((thread) => thread._id === id)
  }

  /*
   * Only expose a thread ID after Convex has confirmed that
   * the thread belongs to the current anonymous session.
   */
  const activeThreadId =
    rows !== undefined
      ? isThreadValid(selectedThreadId)
        ? selectedThreadId
        : isThreadValid(savedThreadId)
          ? savedThreadId
          : threads[0]?._id ?? null
      : null

  /*
   * Clear a stale thread ID from localStorage.
   */
  useEffect(() => {
    if (rows === undefined) {
      return
    }

    if (
      savedThreadId &&
      !threads.some(
        (thread) => thread._id === savedThreadId,
      )
    ) {
      saveLastActiveThreadId(null)
    }
  }, [rows, savedThreadId, threads])

  /*
   * If the currently selected thread disappears, stop using it.
   */
  useEffect(() => {
    if (rows === undefined) {
      return
    }

    if (
      selectedThreadId &&
      !threads.some(
        (thread) => thread._id === selectedThreadId,
      )
    ) {
      setSelectedThreadId(null)
    }
  }, [rows, selectedThreadId, threads])

  const selectThread = (threadId: string) => {
    /*
     * Never select a thread that Convex has not confirmed.
     */
    if (!isThreadValid(threadId)) {
      return
    }

    setSelectedThreadId(threadId)
    saveLastActiveThreadId(threadId)
  }

  const createThread = async () => {
    if (isCreating) {
      return null
    }

    setIsCreating(true)

    try {
      let nextCapability = capability

      /*
       * If there is no anonymous session, create one first.
       */
      if (!nextCapability) {
        nextCapability = await createSession({})

        saveAnonymousChatCapability(nextCapability)
        setCapability(nextCapability)
      }

      /*
       * Create the thread using the SAME capability that will
       * subsequently be used to send messages.
       */
      const threadId = await createNewThread({
        capability: nextCapability,
      })

      /*
       * This thread was just created by this exact session,
       * so it is safe to select it immediately.
       */
      setSelectedThreadId(threadId)
      saveLastActiveThreadId(threadId)

      return threadId
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error)

      /*
       * If the session is invalid, completely reset the
       * anonymous session state.
       */
      if (
        message
          .toLowerCase()
          .includes("chat session not found") ||
        message
          .toLowerCase()
          .includes("conversation not found")
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
