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

const POLL_INTERVAL_MS = 120
const MAX_POLL_MS = 5 * 60 * 1000

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

      const normalized = messageText.toLowerCase()

      if (normalized.includes("conversation not found")) {
        throw new Error(
          "This conversation is no longer available. Please start a new conversation.",
        )
      }

      if (normalized.includes("chat session not found")) {
        throw new Error(
          "This chat session has expired. Please start a new conversation.",
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

    if (!active) {
      return null
    }

    return this.watchRun(active.runId, undefined)
  }

  private watchRun(
    runId: Id<"chatRuns">,
    abortSignal: AbortSignal | undefined,
  ) {
    let closed = false
    let cursor = 0

    const stream = new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const finish = () => {
          if (closed) return

          closed = true
          controller.close()
        }

        const fail = (error: unknown) => {
          if (closed) return

          closed = true

          controller.error(
            error instanceof Error
              ? error
              : new Error(String(error)),
          )
        }

        const onAbort = () => {
          if (closed) return

          closed = true
          controller.close()
        }

        if (abortSignal) {
          if (abortSignal.aborted) {
            onAbort()
            return
          }

          abortSignal.addEventListener(
            "abort",
            onAbort,
            { once: true },
          )
        }

        const poll = async () => {
          const startedAt = Date.now()

          try {
            while (!closed) {
              if (
                Date.now() - startedAt >
                MAX_POLL_MS
              ) {
                throw new Error(
                  "The reply took too long to finish. Please try again.",
                )
              }

              const snapshot =
                await this.client.query(
                  api.agentChat.streamRun,
                  {
                    capability: this.capability,
                    runId,
                    cursor,
                  },
                )

              if (closed) {
                return
              }

              for (const batch of snapshot.batches) {
                if (batch.end <= cursor) {
                  continue
                }

                const offset = Math.max(
                  0,
                  cursor - batch.start,
                )

                const chunks =
                  batch.chunks.slice(offset)

                for (const chunk of chunks) {
                  controller.enqueue(
                    chunk as UIMessageChunk,
                  )
                }

                cursor = Math.max(
                  cursor,
                  batch.end,
                )
              }

              if (
                snapshot.status === "failed"
              ) {
                throw new Error(
                  snapshot.error ??
                    "Reply generation failed.",
                )
              }

              if (
                snapshot.status === "completed"
              ) {
                finish()
                return
              }

              await new Promise<void>(
                (resolve) => {
                  setTimeout(
                    resolve,
                    POLL_INTERVAL_MS,
                  )
                },
              )
            }
          } catch (error) {
            fail(error)
          } finally {
            if (abortSignal) {
              abortSignal.removeEventListener(
                "abort",
                onAbort,
              )
            }
          }
        }

        void poll()
      },

      cancel: () => {
        closed = true
      },
    })

    return stream
  }
}
