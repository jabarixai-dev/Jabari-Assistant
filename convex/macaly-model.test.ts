import {
  APICallError,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
} from "@ai-sdk/provider"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createMacalyLanguageModel } from "../convex/macalyModel"

const baseOptions: LanguageModelV4CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
}

function model() {
  return createMacalyLanguageModel({
    baseUrl: "https://macaly.test",
    apiToken: "secret-token",
    chatId: "chat-123",
    preset: "CODE",
  })
}

function sse(chunks: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  )
}

async function collectStream(stream: ReadableStream<LanguageModelV4StreamPart>) {
  const reader = stream.getReader()
  const parts: LanguageModelV4StreamPart[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) return parts
    parts.push(value)
  }
}

afterEach(() => vi.restoreAllMocks())

describe("Macaly LanguageModelV4", () => {
  it("maps instant text and tool calls", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        success: true,
        text: "Checking that now.",
        finishReason: "tool-calls",
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "lookupOrder",
            input: { orderId: "ORD-123" },
          },
        ],
      }),
    )

    const result = await model().doGenerate(baseOptions)

    expect(result.content).toEqual([
      { type: "text", text: "Checking that now." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "lookupOrder",
        input: '{"orderId":"ORD-123"}',
      },
    ])
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      chatId: "chat-123",
      preset: "CODE",
      mode: "instant",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    })
  })

  it("maps tools, tool choice, and raw tool results", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ success: true, text: "Done", finishReason: "stop" }))

    await model().doGenerate({
      ...baseOptions,
      prompt: [
        { role: "system", content: "Be useful" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookupOrder",
              input: { orderId: "ORD-123" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "lookupOrder",
              output: { type: "json", value: { status: "shipped" } },
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          name: "lookupOrder",
          description: "Look up an order",
          inputSchema: {
            type: "object",
            properties: { orderId: { type: "string" } },
            required: ["orderId"],
          },
        },
      ],
      toolChoice: { type: "tool", toolName: "lookupOrder" },
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.tools[0]).toMatchObject({
      name: "lookupOrder",
      parameters: { type: "object" },
    })
    expect(body.toolChoice).toEqual({ type: "tool", toolName: "lookupOrder" })
    expect(body.messages[2].content[0].output).toEqual({ status: "shipped" })
  })

  it("parses split SSE frames and emits a complete tool call", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([
        'data: {"type":"text-delta","text":"Hel',
        'lo"}\r\n\r\ndata: {"type":"tool-call","toolCallId":"call-1",',
        '"toolName":"lookupOrder","input":{"orderId":"ORD-123"}}\r\n\r\n',
        'data: {"type":"finish","finishReason":"tool-calls"}\r\n\r\ndata: [DONE]\r\n\r\n',
      ]),
    )

    const result = await model().doStream(baseOptions)
    const parts = await collectStream(result.stream)

    expect(parts).toContainEqual({ type: "text-delta", id: "text-0", delta: "Hello" })
    expect(parts).toContainEqual({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "lookupOrder",
      input: '{"orderId":"ORD-123"}',
    })
    expect(parts.filter((part) => part.type === "finish")).toHaveLength(1)
  })

  it("marks payment failures non-retryable and rate limits retryable", async () => {
    for (const [status, retryable] of [
      [402, false],
      [429, true],
    ] as const) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response('{"error":"failed"}', { status }),
      )
      const error = await Promise.resolve(model().doGenerate(baseOptions)).catch(
        (value) => value,
      )
      expect(APICallError.isInstance(error)).toBe(true)
      expect(error.isRetryable).toBe(retryable)
      expect(String(error)).not.toContain("secret-token")
    }
  })

  it("fails on premature SSE EOF", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse(['data: {"type":"text-delta","text":"unfinished"}\n\n']),
    )
    const result = await model().doStream(baseOptions)
    await expect(collectStream(result.stream)).rejects.toThrow("ended prematurely")
  })
})
