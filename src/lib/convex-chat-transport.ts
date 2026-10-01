import type {
  ChatTransport,
  UIMessage,
  UIMessageChunk,
} from "ai"
import type { ConvexReactClient } from "convex/react"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export class ConvexChatTransport
  implements ChatTransport<UIMessage>
{
  constructor(
    private readonly client: ConvexReactClient,
    private readonly capability: string,
  ) {}

  async sendMessages(
    options: Parameters<
      ChatTransport<UIMessage>["sendMessages"]
    >[0],
  ) {
    if (options.trigger !== "submit-message") {
      throw new Error(
        "Regeneration is not implemented for this chat.",
      )
    }

    const message = options.messages.at(-1)

    if (!message || message.role !== "user") {
      throw new Error("A user message is required.")
    }

    try {
      const runId = await this.client.mutation(
        api.agentChat.submitMessage,
        {
          capability: this.capability,
          threadId: options.chatId,
          message: serializable(message),
        },
      )

      return this.watchRun(runId, options.abortSignal)
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error)

      /*
       * Give the UI a useful error instead of silently presenting
       * the generic generation failure.
       */
      if (messageText.includes("Conversation not found")) {
        throw new Error(
          "This conversation has expired. Please start a new conversation.",
        )
      }

      throw error
    }
  }

  async reconnectToStream(
    options: Parameters<
      ChatTransport<UIMessage>["reconnectToStream"]
    >[0],
  ) {
    const active = await this.client.query(
      api.agentChat.getActiveRun,
      {
        capability: this.capability,
        threadId: options.chatId,
      },
    )

    return active
      ? this.watchRun(active.runId, undefined)
      : null
  }

  private watchRun(
    runId: Id<"chatRuns">,
    abortSignal: AbortSignal | undefined,
  ) {
    let unsubscribe: (() => void) | undefined
    let cursor = 0
    let closed = false
    let restartQueued = false

    const stream = new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const close = () => {
          if (closed) return

          closed = true
          unsubscribe?.()
          controller.close()
        }

        const fail = (error: unknown) => {
          if (closed) return

          closed = true
          unsubscribe?.()
          controller.error(error)
        }

        const watchFromCursor = () => {
          if (closed) return

          unsubscribe?.()

          const pageStart = cursor

          const watch = this.client.watchQuery(
            api.agentChat.streamRun,
            {
              capability: this.capability,
              runId,
              cursor,
            },
          )

          const update = () => {
            try {
              const snapshot = watch.localQueryResult()

              if (!snapshot) return

              for (const batch of snapshot.batches) {
                if (batch.end <= cursor) continue

                const offset = Math.max(
                  0,
                  cursor - batch.start,
                )

                for (const chunk of batch.chunks.slice(offset)) {
                  controller.enqueue(chunk as UIMessageChunk)
                }

                cursor = Math.max(cursor, batch.end)
              }

              if (
                snapshot.batches.length === 50 &&
                cursor > pageStart
              ) {
                unsubscribe?.()
                unsubscribe = undefined

                if (!restartQueued) {
                  restartQueued = true

                  queueMicrotask(() => {
                    restartQueued = false
                    watchFromCursor()
                  })
                }

                return
              }

              if (snapshot.status === "failed") {
                fail(
                  new Error(
                    snapshot.error ??
                      "Reply generation failed.",
                  ),
                )
              } else if (
                snapshot.status === "completed"
              ) {
                close()
              }
            } catch (error) {
              fail(error)
            }
          }

          unsubscribe = watch.onUpdate(update)
          update()
        }

        watchFromCursor()

        if (abortSignal) {
          abortSignal.addEventListener(
            "abort",
            close,
            { once: true },
          )
        }
      },

      cancel: () => {
        closed = true
        unsubscribe?.()
      },
    })

    return stream
  }
}
