import { httpRouter, httpActionGeneric } from "convex/server"
import { auth } from "./auth"
import { internal } from "./_generated/api"

const http = httpRouter()
auth.addHttpRoutes(http)

http.route({
  path: "/paystack/webhook",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret) return new Response("Paystack is not configured.", { status: 503 })
    const rawBody = await request.text()
    const signature = request.headers.get("x-paystack-signature")
    if (!signature) return new Response("Missing signature.", { status: 401 })
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"])
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
    const expected = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
    if (expected !== signature) return new Response("Invalid signature.", { status: 401 })
    const event = JSON.parse(rawBody)
    if (event.event === "charge.success" && event.data?.reference) {
      await ctx.runMutation(internal.billing.reconcilePaystackPayment, {
        reference: event.data.reference,
        status: event.data.status === "success" ? "success" : "pending",
        transactionId: typeof event.data.id === "number" ? event.data.id : undefined,
        amount: Number(event.data.amount || 0) / 100,
        currency: String(event.data.currency || ""),
      })
    }
    return new Response("OK", { status: 200 })
  }),
})

export default http
