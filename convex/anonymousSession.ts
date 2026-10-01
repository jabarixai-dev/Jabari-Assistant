"use node"

import { randomBytes } from "node:crypto"
import { v } from "convex/values"

import { internal } from "./_generated/api"
import { action } from "./_generated/server"

function sessionMessageLimit() {
  const value = Number(process.env.ANONYMOUS_CHAT_MESSAGE_LIMIT ?? "30")
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new Error("ANONYMOUS_CHAT_MESSAGE_LIMIT must be an integer from 1 to 200.")
  }
  return value
}

export const create = action({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    if (process.env.ANONYMOUS_CHAT_ENABLED !== "true") {
      throw new Error("Anonymous chat is currently disabled.")
    }
    const capability = randomBytes(32).toString("base64url")
    await ctx.runMutation(internal.agentChat.createAnonymousSessionRecord, {
      capability,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      remainingMessages: sessionMessageLimit(),
    })
    return capability
  },
})
