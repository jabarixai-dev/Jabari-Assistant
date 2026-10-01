import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4Content,
  type LanguageModelV4FinishReason,
  type LanguageModelV4StreamPart,
  type LanguageModelV4ToolResultOutput,
  type LanguageModelV4Usage,
  type SharedV4Warning,
} from "@ai-sdk/provider"

type MacalyModelOptions = {
  baseUrl: string
  apiToken: string
  chatId: string
  bypassHeader?: string
  preset?: "FAST" | "DOCS" | "REASONING" | "CODE"
  model?: string
}

type MacalyContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType?: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | {
      type: "tool-result"
      toolCallId: string
      toolName: string
      output: unknown
    }

type MacalyMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | MacalyContentPart[]
}

type MacalyToolCall = {
  toolCallId: string
  toolName: string
  input: unknown
}

type MacalyInstantResponse = {
  success: boolean
  text?: string
  finishReason?: string
  toolCalls?: MacalyToolCall[]
  error?: string
}

type MacalyStreamEvent =
  | { type: "text-delta"; text: string }
  | ({ type: "tool-call" } & MacalyToolCall)
  | { type: "finish"; finishReason?: string }
  | { type: "error"; message?: string }

const unknownUsage: LanguageModelV4Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
}

function finishReason(raw: string | undefined): LanguageModelV4FinishReason {
  const unified =
    raw === "stop" ||
    raw === "length" ||
    raw === "content-filter" ||
    raw === "tool-calls" ||
    raw === "error"
      ? raw
      : "other"
  return { unified, raw }
}

function warningsFor(options: LanguageModelV4CallOptions): SharedV4Warning[] {
  const unsupported: Array<[boolean, string]> = [
    [Boolean(options.stopSequences?.length), "stopSequences"],
    [options.topK !== undefined, "topK"],
    [options.presencePenalty !== undefined, "presencePenalty"],
    [options.frequencyPenalty !== undefined, "frequencyPenalty"],
    [options.seed !== undefined, "seed"],
    [
      options.responseFormat !== undefined &&
        options.responseFormat.type !== "text",
      "responseFormat",
    ],
    [options.reasoning !== undefined, "reasoning"],
    [options.providerOptions !== undefined, "providerOptions"],
  ]
  return unsupported
    .filter(([enabled]) => enabled)
    .map(([, feature]) => ({
      type: "unsupported" as const,
      feature,
      details:
        "Macaly's llm-usage endpoint does not currently expose this option.",
    }))
}

function encodeBytes(data: Uint8Array | string): string {
  if (typeof data === "string") return data
  let binary = ""
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function toolOutput(output: LanguageModelV4ToolResultOutput): unknown {
  if (output.type === "text" || output.type === "json") return output.value
  if (output.type === "execution-denied") {
    return { type: output.type, reason: output.reason }
  }
  if (output.type === "error-text" || output.type === "error-json") {
    return { type: output.type, value: output.value }
  }
  return output.value.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text }
    if (part.type === "custom") return { type: "custom" }
    if (!part.mediaType.startsWith("image/")) {
      throw new Error(`Unsupported tool result file type: ${part.mediaType}`)
    }
    if (part.data.type === "reference" || part.data.type === "text") {
      throw new Error(`Unsupported tool result image data: ${part.data.type}`)
    }
    return {
      type: "image",
      image:
        part.data.type === "url"
          ? part.data.url.toString()
          : encodeBytes(part.data.data),
      mediaType: part.mediaType,
    }
  })
}

function convertMessages(options: LanguageModelV4CallOptions): MacalyMessage[] {
  return options.prompt.map((message): MacalyMessage => {
    if (message.role === "system")
      return { role: "system", content: message.content }

    if (message.role === "user") {
      return {
        role: "user",
        content: message.content.map((part) => {
          if (part.type === "text") return { type: "text", text: part.text }
          if (!part.mediaType.startsWith("image/")) {
            throw new Error(`Unsupported file type: ${part.mediaType}`)
          }
          if (part.data.type === "reference" || part.data.type === "text") {
            throw new Error(`Unsupported image data: ${part.data.type}`)
          }
          return {
            type: "image",
            image:
              part.data.type === "url"
                ? part.data.url.toString()
                : encodeBytes(part.data.data),
            mediaType: part.mediaType,
          }
        }),
      }
    }

    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content.flatMap((part): MacalyContentPart[] => {
          if (part.type === "text") return [{ type: "text", text: part.text }]
          if (part.type === "tool-call") {
            if (part.providerExecuted)
              throw new Error("Provider-executed tools are not supported")
            return [
              {
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              },
            ]
          }
          if (part.type === "tool-result") {
            return [
              {
                type: "tool-result",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: toolOutput(part.output),
              },
            ]
          }
          return []
        }),
      }
    }

    return {
      role: "tool",
      content: message.content.map((part) => {
        if (part.type === "tool-approval-response") {
          return {
            type: "tool-result" as const,
            toolCallId: part.approvalId,
            toolName: "approval",
            output: { approved: part.approved, reason: part.reason },
          }
        }
        return {
          type: "tool-result" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: toolOutput(part.output),
        }
      }),
    }
  })
}

function convertTools(options: LanguageModelV4CallOptions) {
  return options.tools?.map((tool) => {
    if (tool.type !== "function")
      throw new Error(`Unsupported provider tool: ${tool.name}`)
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }
  })
}

function convertToolChoice(options: LanguageModelV4CallOptions) {
  const choice = options.toolChoice
  if (!choice) return undefined
  return choice.type === "tool" ? choice : choice.type
}

function requestBody(
  config: MacalyModelOptions,
  options: LanguageModelV4CallOptions,
  mode: "instant" | "streaming",
) {
  return {
    chatId: config.chatId,
    ...(config.preset ? { preset: config.preset } : { model: config.model }),
    mode,
    messages: convertMessages(options),
    tools: convertTools(options),
    toolChoice: convertToolChoice(options),
    temperature: options.temperature,
    maxTokens: options.maxOutputTokens,
    topP: options.topP,
  }
}

async function responseError(response: Response, url: string, body: unknown) {
  const responseBody = await response.text()
  return new APICallError({
    message:
      response.status === 402
        ? "Macaly credits are required for this request."
        : response.status === 429
          ? "Macaly LLM rate limit exceeded."
          : `Macaly LLM request failed with status ${response.status}.`,
    url,
    requestBodyValues: body,
    statusCode: response.status,
    responseHeaders: Object.fromEntries(response.headers.entries()),
    responseBody,
    isRetryable: response.status === 429 || response.status >= 500,
  })
}

function contentFromResponse(response: MacalyInstantResponse) {
  const content: LanguageModelV4Content[] = []
  if (response.text) content.push({ type: "text", text: response.text })
  for (const call of response.toolCalls ?? []) {
    content.push({
      type: "tool-call",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: JSON.stringify(call.input ?? {}),
    })
  }
  return content
}

function parseSseFrame(frame: string) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
  return data.length ? data.join("\n") : undefined
}

export function createMacalyLanguageModel(
  config: MacalyModelOptions,
): LanguageModelV4 {
  if (!config.preset && !config.model)
    throw new Error("A Macaly preset or model is required")

  const url = `${config.baseUrl.replace(/\/$/, "")}/api/client-app/llm-usage`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiToken}`,
    "Content-Type": "application/json",
  }
  if (config.bypassHeader) {
    const separator = config.bypassHeader.indexOf(":")
    const name = config.bypassHeader.slice(0, separator).trim().toLowerCase()
    const value = config.bypassHeader.slice(separator + 1).trim()
    if (name !== "x-vercel-protection-bypass" || !value) {
      throw new Error("Invalid MACALY_BYPASS_HEADER")
    }
    headers[name] = value
  }

  return {
    specificationVersion: "v4",
    provider: "macaly",
    modelId: config.model ?? `preset:${config.preset}`,
    supportedUrls: { "image/*": [/^https?:\/\//] },

    async doGenerate(options) {
      const body = requestBody(config, options, "instant")
      const signals = [AbortSignal.timeout(300_000)]
      if (options.abortSignal) signals.push(options.abortSignal)
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      })
      if (!response.ok) throw await responseError(response, url, body)
      const json = (await response.json()) as MacalyInstantResponse
      if (!json.success)
        throw new Error(json.error ?? "Macaly LLM request failed")
      return {
        content: contentFromResponse(json),
        finishReason: finishReason(json.finishReason),
        usage: unknownUsage,
        warnings: warningsFor(options),
      }
    },

    async doStream(options) {
      const body = requestBody(config, options, "streaming")
      // A stalled proxy connection would otherwise hold the Convex action
      // until its 10-minute limit; abort after two minutes without data.
      const abort = new AbortController()
      const onUpstreamAbort = () => abort.abort(options.abortSignal?.reason)
      if (options.abortSignal?.aborted) onUpstreamAbort()
      options.abortSignal?.addEventListener("abort", onUpstreamAbort, {
        once: true,
      })
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const resetIdleTimer = () => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(
          () => abort.abort(new Error("Macaly LLM stream stalled")),
          120_000,
        )
      }
      resetIdleTimer()
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abort.signal,
      })
      if (!response.ok) {
        clearTimeout(idleTimer)
        throw await responseError(response, url, body)
      }
      if (!response.body) {
        clearTimeout(idleTimer)
        throw new Error("Macaly LLM stream returned no body")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let cancelled = false
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          let buffer = ""
          let textStarted = false
          let finished = false
          controller.enqueue({
            type: "stream-start",
            warnings: warningsFor(options),
          })

          const closeText = () => {
            if (!textStarted) return
            controller.enqueue({ type: "text-end", id: "text-0" })
            textStarted = false
          }
          const emitFinish = (raw: string | undefined) => {
            if (finished) return
            closeText()
            finished = true
            controller.enqueue({
              type: "finish",
              finishReason: finishReason(raw),
              usage: unknownUsage,
            })
          }
          const handleData = (data: string) => {
            if (data === "[DONE]") return emitFinish(undefined)
            let event: MacalyStreamEvent
            try {
              event = JSON.parse(data) as MacalyStreamEvent
            } catch (error) {
              throw new Error("Macaly LLM stream contained invalid JSON", {
                cause: error,
              })
            }
            if (event.type === "text-delta") {
              if (!textStarted) {
                textStarted = true
                controller.enqueue({ type: "text-start", id: "text-0" })
              }
              controller.enqueue({
                type: "text-delta",
                id: "text-0",
                delta: event.text,
              })
            } else if (event.type === "tool-call") {
              const input = JSON.stringify(event.input ?? {})
              controller.enqueue({
                type: "tool-input-start",
                id: event.toolCallId,
                toolName: event.toolName,
              })
              controller.enqueue({
                type: "tool-input-delta",
                id: event.toolCallId,
                delta: input,
              })
              controller.enqueue({
                type: "tool-input-end",
                id: event.toolCallId,
              })
              controller.enqueue({
                type: "tool-call",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                input,
              })
            } else if (event.type === "finish") {
              emitFinish(event.finishReason)
            } else if (event.type === "error") {
              finished = true
              closeText()
              controller.enqueue({
                type: "error",
                error: new Error(event.message ?? "Macaly LLM stream failed"),
              })
            }
          }

          try {
            while (!finished) {
              const { value, done } = await reader.read()
              resetIdleTimer()
              buffer += decoder.decode(value, { stream: !done })
              const frames = buffer.split(/\r?\n\r?\n/)
              buffer = frames.pop() ?? ""
              for (const frame of frames) {
                const data = parseSseFrame(frame)
                if (data) handleData(data)
                if (finished) break
              }
              if (done) {
                if (!finished && buffer.trim()) {
                  const data = parseSseFrame(buffer)
                  if (data) handleData(data)
                }
                if (!finished)
                  throw new Error("Macaly LLM stream ended prematurely")
              }
            }
            // The provider may keep the connection open after its finish
            // event; release it instead of waiting for [DONE].
            await reader.cancel().catch(() => {})
            controller.close()
          } catch (error) {
            if (!cancelled) controller.error(error)
          } finally {
            clearTimeout(idleTimer)
            reader.releaseLock()
          }
        },
        async cancel() {
          cancelled = true
          clearTimeout(idleTimer)
          await reader.cancel()
        },
      })
      return { stream }
    },
  }
}

export type { MacalyModelOptions }
