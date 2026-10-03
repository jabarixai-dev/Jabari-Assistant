import { v } from "convex/values"
import { internal } from "./_generated/api"
import { getAuthUserId } from "@convex-dev/auth/server"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"

const OWNER_EMAIL = "jabari.xai@gmail.com"

type OwnerCtx = QueryCtx | MutationCtx

async function requireOwner(ctx: any) {
  const userId = await getAuthUserId(ctx)

  if (!userId) {
    throw new Error("Authentication required.")
  }

  return userId
}

const statusValidator = v.union(
  v.literal("new"),
  v.literal("contacted"),
  v.literal("qualified"),
  v.literal("won"),
  v.literal("lost")
)

async function syncOpportunity(
  ctx: any,
  lead: any,
  status: string,
  now: number
) {
  if (
    status !== "qualified" &&
    status !== "won" &&
    status !== "lost"
  ) {
    return
  }

  const contact = await ctx.db
    .query("contacts")
    .withIndex("by_email", (q: any) =>
      q.eq("email", lead.email)
    )
    .first()

  const existing = await ctx.db
    .query("opportunities")
    .withIndex("by_leadId", (q: any) =>
      q.eq("leadId", lead._id)
    )
    .first()

  const stage =
    status === "qualified"
      ? "qualified"
      : status

  const probability =
    status === "won"
      ? 100
      : status === "lost"
        ? 0
        : 50

  const raw = String(lead.budget || "").replace(
    /[^0-9.]/g,
    ""
  )

  const value = Number(raw) || 0

  if (existing) {
    await ctx.db.patch(existing._id, {
      stage,
      probability,
      updatedAt: now,
      contactId:
        contact?._id || existing.contactId,
    })

    if (status === "won" && value > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.billing.createWonInvoice,
        {
          opportunityId: existing._id,
        }
      )
    }

    return existing._id
  }

  const id = await ctx.db.insert(
    "opportunities",
    {
      leadId: lead._id,
      contactId: contact?._id,
      name:
        lead.company +
        " — " +
        lead.request,
      stage,
      value,
      probability,
      owner: OWNER_EMAIL,
      notes:
        "Created automatically from lead stage " +
        status +
        ".",
      createdAt: now,
      updatedAt: now,
    }
  )

  if (status === "won" && value > 0) {
    await ctx.scheduler.runAfter(
      0,
      internal.billing.createWonInvoice,
      {
        opportunityId: id,
      }
    )
  }

  return id
}

export const capture = internalMutation({
  args: {
    threadId: v.id("chatThreads"),
    name: v.string(),
    email: v.string(),
    company: v.string(),
    request: v.string(),
    budget: v.string(),
    timeline: v.string(),
  },

  returns: v.object({
    id: v.id("leads"),
    status: v.string(),
  }),

  handler: async (ctx, args) => {
    const email = args.email
      .trim()
      .toLowerCase()

    const name = args.name.trim()
    const companyName = args.company.trim()
    const request = args.request.trim()

    if (
      !name ||
      !email ||
      !request ||
      !email.includes("@")
    ) {
      throw new Error(
        "Lead details are incomplete."
      )
    }

    const existing = await ctx.db
      .query("leads")
      .withIndex("by_threadId", (q) =>
        q.eq("threadId", args.threadId)
      )
      .take(10)

    const now = Date.now()

    const current = existing.find(
      (lead: any) =>
        lead.email === email
    )

    let companyId: any = undefined

    if (companyName) {
      let c = await ctx.db
        .query("companies")
        .withIndex("by_name", (q) =>
          q.eq("name", companyName)
        )
        .first()

      if (!c) {
        const id = await ctx.db.insert(
          "companies",
          {
            name: companyName,
            createdAt: now,
            updatedAt: now,
          }
        )

        c = await ctx.db.get(id)
      }

      companyId = c?._id
    }

    if (current) {
      await ctx.db.patch(current._id, {
        name,
        company: companyName,
        request,
        budget: args.budget.trim(),
        timeline: args.timeline.trim(),
        updatedAt: now,
      })

      const contact = await ctx.db
        .query("contacts")
        .withIndex("by_email", (q) =>
          q.eq("email", email)
        )
        .first()

      if (contact) {
        await ctx.db.patch(contact._id, {
          name,
          company: companyName,
          companyId,
          updatedAt: now,
        })
      }

      return {
        id: current._id,
        status: current.status,
      }
    }

    const id = await ctx.db.insert(
      "leads",
      {
        threadId: args.threadId,
        name,
        email,
        company: companyName,
        request,
        budget: args.budget.trim(),
        timeline: args.timeline.trim(),
        status: "new",
        createdAt: now,
        updatedAt: now,
      }
    )

    const contactId = await ctx.db.insert(
      "contacts",
      {
        name,
        email,
        company: companyName,
        source: "website_chat",
        leadId: id,
        companyId,
        createdAt: now,
        updatedAt: now,
      }
    )

    await ctx.db.insert(
      "crmActivities",
      {
        contactId,
        leadId: id,
        type: "lead_created",
        title: "Lead captured",
        detail: request,
        createdAt: now,
      }
    )

    await ctx.scheduler.runAfter(
      0,
      internal.workflows.executeForLead,
      {
        leadId: id,
        event: "lead_created",
        status: "new",
      }
    )

    return {
      id,
      status: "new",
    }
  },
})

export const listRecent = internalQuery({
  args: {},

  returns: v.array(v.any()),

  handler: async (ctx) => {
    await requireOwner(ctx)

    return await ctx.db
      .query("leads")
      .withIndex(
        "by_status_and_updatedAt"
      )
      .order("desc")
      .take(50)
  },
})

export const listRecentForOwner = query({
  args: {},

  returns: v.array(v.any()),

  handler: async (ctx) => {
    await requireOwner(ctx)

    return await ctx.db
      .query("leads")
      .withIndex(
        "by_status_and_updatedAt"
      )
      .order("desc")
      .take(50)
  },
})

export const updateStatus = mutation({
  args: {
    leadId: v.id("leads"),
    status: statusValidator,
  },

  returns: v.null(),

  handler: async (ctx, args) => {
    await requireOwner(ctx)

    const lead = await ctx.db.get(
      args.leadId
    )

    if (!lead) {
      throw new Error("Lead not found.")
    }

    const now = Date.now()

    if (lead.status === args.status) {
      return null
    }

    await ctx.db.patch(lead._id, {
      status: args.status,
      updatedAt: now,
    })

    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) =>
        q.eq("email", lead.email)
      )
      .first()

    if (contact) {
      await ctx.db.insert(
        "crmActivities",
        {
          contactId: contact._id,
          leadId: lead._id,
          type: "status_changed",
          title: "Lead status changed",
          detail:
            lead.status +
            " → " +
            args.status,
          createdAt: now,
        }
      )
    }

    await syncOpportunity(
      ctx,
      lead,
      args.status,
      now
    )

    await ctx.scheduler.runAfter(
      0,
      internal.workflows.executeForLead,
      {
        leadId: lead._id,
        event: "stage_changed",
        status: args.status,
      }
    )

    return null
  },
})

export const getLeadForOwner = query({
  args: {
    leadId: v.id("leads"),
  },

  returns: v.any(),

  handler: async (ctx, args) => {
    await requireOwner(ctx)

    const lead = await ctx.db.get(
      args.leadId
    )

    if (!lead) {
      return null
    }

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex(
        "by_threadId_and_order",
        (q) =>
          q.eq(
            "threadId",
            lead.threadId
          )
      )
      .order("asc")
      .take(100)

    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) =>
        q.eq("email", lead.email)
      )
      .first()

    const activities = contact
      ? await ctx.db
          .query("crmActivities")
          .withIndex(
            "by_contactId_and_createdAt",
            (q) =>
              q.eq(
                "contactId",
                contact._id
              )
          )
          .order("desc")
          .take(100)
      : []

    return {
      lead,
      messages: messages.map(
        (row: any) => row.message
      ),
      contact,
      activities,
    }
  },
})

/**
 * Delete a conversation from the Conversation Inbox.
 *
 * This removes:
 * - the lead from the Conversation Inbox
 * - its chat messages
 * - its chat thread
 *
 * It intentionally preserves:
 * - the CRM contact
 * - Gmail messages
 * - company information
 */
export const deleteConversation = mutation({
  args: {
    leadId: v.id("leads"),
  },

  returns: v.null(),

  handler: async (ctx, args) => {
    await requireOwner(ctx)

    const lead = await ctx.db.get(
      args.leadId
    )

    if (!lead) {
      return null
    }

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex(
        "by_threadId_and_order",
        (q) =>
          q.eq(
            "threadId",
            lead.threadId
          )
      )
      .take(500)

    for (const message of messages) {
      await ctx.db.delete(message._id)
    }

    const thread = await ctx.db.get(
      lead.threadId
    )

    if (thread) {
      await ctx.db.delete(
        thread._id
      )
    }

    await ctx.db.delete(
      lead._id
    )

    return null
  },
})

export const getLeadForCopilot =
  internalQuery({
    args: {
      leadId: v.id("leads"),
    },

    returns: v.any(),

    handler: async (ctx, args) => {
      const lead = await ctx.db.get(
        args.leadId
      )

      if (!lead) {
        return null
      }

      const messages = await ctx.db
        .query("chatMessages")
        .withIndex(
          "by_threadId_and_order",
          (q) =>
            q.eq(
              "threadId",
              lead.threadId
            )
        )
        .order("asc")
        .take(100)

      const contact = await ctx.db
        .query("contacts")
        .withIndex("by_email", (q) =>
          q.eq("email", lead.email)
        )
        .first()

      const activities = contact
        ? await ctx.db
            .query("crmActivities")
            .withIndex(
              "by_contactId_and_createdAt",
              (q) =>
                q.eq(
                  "contactId",
                  contact._id
                )
            )
            .order("desc")
            .take(100)
        : []

      return {
        lead,
        messages: messages.map(
          (row: any) => row.message
        ),
        contact,
        activities,
      }
    },
  })
