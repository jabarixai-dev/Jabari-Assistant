import { useSyncExternalStore } from "react"

function createLocalStorageStore(key: string) {
  const listeners = new Set<() => void>()

  const getSnapshot = () => {
    if (typeof window === "undefined") {
      return null
    }

    return window.localStorage.getItem(key)
  }

  const getServerSnapshot = () => null

  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === key) {
      emit()
    }
  }

  const subscribe = (listener: () => void) => {
    listeners.add(listener)

    window.addEventListener("storage", onStorage)

    return () => {
      listeners.delete(listener)

      if (listeners.size === 0) {
        window.removeEventListener("storage", onStorage)
      }
    }
  }

  const set = (value: string | null) => {
    if (typeof window === "undefined") {
      return
    }

    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }

    emit()
  }

  return {
    getSnapshot,
    getServerSnapshot,
    subscribe,
    set,
  }
}

const capabilityStore = createLocalStorageStore(
  "anonymous-chat-capability-v1",
)

const activeThreadStore = createLocalStorageStore(
  "anonymous-chat-active-thread-v1",
)

export function useAnonymousChatCapability() {
  return useSyncExternalStore(
    capabilityStore.subscribe,
    capabilityStore.getSnapshot,
    capabilityStore.getServerSnapshot,
  )
}

export function saveAnonymousChatCapability(
  capability: string | null,
) {
  capabilityStore.set(capability)
}

export function useLastActiveThreadId() {
  return useSyncExternalStore(
    activeThreadStore.subscribe,
    activeThreadStore.getSnapshot,
    activeThreadStore.getServerSnapshot,
  )
}

export function saveLastActiveThreadId(
  threadId: string | null,
) {
  activeThreadStore.set(threadId)
}
