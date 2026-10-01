import { useSyncExternalStore } from "react"

function localStorageValue(key: string) {
  const listeners = new Set<() => void>()

  const getSnapshot = () =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key)
  const getServerSnapshot = () => null
  const emit = () => listeners.forEach((listener) => listener())
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) emit()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    window.addEventListener("storage", onStorage)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) window.removeEventListener("storage", onStorage)
    }
  }
  const set = (value: string | null) => {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
    emit()
  }

  return { getSnapshot, getServerSnapshot, subscribe, set }
}

const capabilityStore = localStorageValue("anonymous-chat-capability-v1")
const activeThreadStore = localStorageValue("anonymous-chat-active-thread-v1")

export function useAnonymousChatCapability() {
  return useSyncExternalStore(
    capabilityStore.subscribe,
    capabilityStore.getSnapshot,
    capabilityStore.getServerSnapshot,
  )
}

export function saveAnonymousChatCapability(capability: string | null) {
  capabilityStore.set(capability)
}

export function useLastActiveThreadId() {
  return useSyncExternalStore(
    activeThreadStore.subscribe,
    activeThreadStore.getSnapshot,
    activeThreadStore.getServerSnapshot,
  )
}

export function saveLastActiveThreadId(threadId: string | null) {
  activeThreadStore.set(threadId)
}
