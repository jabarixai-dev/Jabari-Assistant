import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

// Fake timers keep the scheduled generateReply action from running in the
// background, so run status and quota assertions are deterministic.
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

async function createSession(
  t: ReturnType<typeof convexTest>,
  capability: string,
) {
  await t.mutation(internal.agentChat.createAnonymousSessionRecord, {
    capability,
    expiresAt: Date.now() + 60_000,
    remainingMessages: 5,
  })
}

function userMessage(id: string, text: string) {
  return { id, role: "user" as const, parts: [{ type: "text", text }] }
}

describe("anonymous durable chat ownership", () => {
  it("rejects random and cross-session capabilities", async () => {
    const t = convexTest(schema, modules)
    const capabilityA = "a".repeat(43)
    const capabilityB = "b".repeat(43)
    await createSession(t, capabilityA)
    await createSession(t, capabilityB)
    const threadId = await t.mutation(api.agentChat.createNewThread, {
      capability: capabilityA,
    })

    await expect(
      t.query(api.agentChat.listMessages, {
        capability: "z".repeat(43),
        threadId,
      }),
    ).rejects.toThrow("Chat session not found")
    await expect(
      t.query(api.agentChat.listMessages, {
        capability: capabilityB,
        threadId,
      }),
    ).rejects.toThrow("Conversation not found")
  })

  it("makes duplicate submission idempotent and charges quota once", async () => {
    const t = convexTest(schema, modules)
    const capability = "c".repeat(43)
    await createSession(t, capability)
    const threadId = await t.mutation(api.agentChat.createNewThread, {
      capability,
    })
    const message = userMessage("message-1", "Hello")

    const firstRun = await t.mutation(api.agentChat.submitMessage, {
      capability,
      threadId,
      message,
    })
    const duplicateRun = await t.mutation(api.agentChat.submitMessage, {
      capability,
      threadId,
      message,
    })

    expect(duplicateRun).toBe(firstRun)
    const result = await t.run(async (ctx) => ({
      messages: await ctx.db.query("chatMessages").collect(),
      runs: await ctx.db.query("chatRuns").collect(),
      session: await ctx.db
        .query("anonymousSessions")
        .withIndex("by_capability", (q) => q.eq("capability", capability))
        .unique(),
    }))
    expect(result.messages).toHaveLength(1)
    expect(result.runs).toHaveLength(1)
    expect(result.session?.remainingMessages).toBe(4)
  })

  it("rejects a second message while a run is active", async () => {
    const t = convexTest(schema, modules)
    const capability = "d".repeat(43)
    await createSession(t, capability)
    const threadId = await t.mutation(api.agentChat.createNewThread, {
      capability,
    })
    await t.mutation(api.agentChat.submitMessage, {
      capability,
      threadId,
      message: userMessage("message-1", "First"),
    })

    await expect(
      t.mutation(api.agentChat.submitMessage, {
        capability,
        threadId,
        message: userMessage("message-2", "Second"),
      }),
    ).rejects.toThrow("Wait for the current reply")
  })

  it("reclaims a stale run so the thread cannot stay locked", async () => {
    const t = convexTest(schema, modules)
    const capability = "e".repeat(43)
    await createSession(t, capability)
    const threadId = await t.mutation(api.agentChat.createNewThread, {
      capability,
    })
    const runId = await t.mutation(api.agentChat.submitMessage, {
      capability,
      threadId,
      message: userMessage("message-1", "First"),
    })
    await t.run(async (ctx) => {
      const run = await ctx.db.get(runId) as any
      if (!run) throw new Error("run not found")
      await ctx.db.patch(runId, {
        status: "streaming",
        attemptId: "dead-attempt",
        updatedAt: Date.now() - 10 * 60_000,
      })
      await ctx.db.patch(run.threadId, { activeRunId: runId })
    })

    await t.mutation(api.agentChat.submitMessage, {
      capability,
      threadId,
      message: userMessage("message-2", "Second"),
    })
    const result = await t.run(async (ctx) => ({
      staleRun: await ctx.db.get(runId),
      session: await ctx.db
        .query("anonymousSessions")
        .withIndex("by_capability", (q) => q.eq("capability", capability))
        .unique(),
    }))
    expect((result.staleRun as any)?.status).toBe("failed")
    // First send charged, stale reclaim refunded, second send charged.
    expect(result.session?.remainingMessages).toBe(4)
  })

  it("refunds quota on failure and reschedules the same message", async () => {
    const t = convexTest(schema, modules)
    const capability = "f".repeat(43)
    await createSession(t, capability)
    const threadId = await t.mutation(api.agentChat.createNewThread, {
      capability,
    })
    const message = userMessage("message-1", "Hello")
    const runId = await t.mutation(api.agentChat.submitMessage, {
      capability,
      threadId,
      message,
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        status: "streaming",
        attemptId: "attempt-1",
        updatedAt: Date.now(),
      })
    })
    await t.mutation(internal.agentChat.failRun, {
      runId,
      attemptId: "attempt-1",
      error: "Provider failed.",
    })

    const retriedRun = await t.mutation(api.agentChat.submitMessage, {
      capability,
      threadId,
      message,
    })
    expect(retriedRun).toBe(runId)
    const result = await t.run(async (ctx) => ({
      run: await ctx.db.get(runId),
      messages: await ctx.db.query("chatMessages").collect(),
      session: await ctx.db
        .query("anonymousSessions")
        .withIndex("by_capability", (q) => q.eq("capability", capability))
        .unique(),
    }))
    expect((result.run as any)?.status).toBe("scheduled")
    expect(result.messages).toHaveLength(1)
    // Charged once, refunded on failure, charged again for the retry.
    expect(result.session?.remainingMessages).toBe(4)
  })
})
