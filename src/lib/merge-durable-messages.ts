export type DurableMessagePart = {
  type: string
  text?: string
}

export type DurableMessage = {
  id: string
  parts: readonly DurableMessagePart[]
}

function hasText(message: DurableMessage): boolean {
  return message.parts.some(
    (part) => part.type === "text" && Boolean(part.text?.trim()),
  )
}

/**
 * Merge reactive Convex history with AI SDK's live state without letting an
 * incomplete live tool-call snapshot replace an already-complete persisted
 * assistant message with the same ID.
 */
export function mergeDurableMessages<T extends DurableMessage>(
  persistedMessages: readonly T[],
  liveMessages: readonly T[],
): T[] {
  const mergedMessages = new Map<string, T>()

  for (const message of persistedMessages) {
    mergedMessages.set(message.id, message)
  }

  for (const message of liveMessages) {
    const persistedMessage = mergedMessages.get(message.id)
    if (persistedMessage && hasText(persistedMessage) && !hasText(message)) {
      continue
    }
    mergedMessages.set(message.id, message)
  }

  return [...mergedMessages.values()]
}
