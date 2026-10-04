import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { internal } from "./_generated/api"
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { sendGmailEmail } from "./gmail"
import { buildBrandedEmailHtml } from "./emailBrand"

const OWNER_EMAIL = "jabari.xai@gmail.com"

async function requireOwner(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error("Authentication required.")
  const user = await ctx.db.get(userId)
  const identity = await ctx.auth.getUserIdentity()
  const identityEmail = String((identity as any)?.email ?? "").toLowerCase()
  if (identityEmail !== OWNER_EMAIL && user?.email?.toLowerCase() !== OWNER_EMAIL) {
    throw new Error("Owner access required.")
  }
}

const stepValidator = v.object({
  type: v.union(
    v.literal("email"),
    v.literal("create_task"),
    v.literal("add_note"),
    v.literal("update_stage"),
  ),
  delayMinutes: v.number(),
  subject: v.optional(v.string()),
  body: v.string(),
})

export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    await requireOwner(ctx)
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(50)

    return await Promise.all(
      campaigns.map(async (campaign) => {
        const steps = await ctx.db
          .query("campaignSteps")
          .withIndex("by_campaign_and_order", (q) => q.eq("campaignId", campaign._id))
          .order("asc")
          .collect()

        const active = await ctx.db
          .query("campaignEnrollments")
          .withIndex("by_campaign_and_status", (q) =>
            q.eq("campaignId", campaign._id).eq("status", "active"),
          )
          .collect()

        return { ...campaign, steps, activeEnrollments: active.length }
      }),
    )
  },
})

export const leadsForEnrollment = query({
  args: { campaignId: v.id("campaigns") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_status_and_updatedAt")
      .order("desc")
      .take(100)

    const enrollments = await ctx.db
      .query("campaignEnrollments")
      .withIndex("by_campaign_and_status", (q) => q.eq("campaignId", args.campaignId))
      .collect()

    const enrolled = new Set(enrollments.map((e) => String(e.leadId)))
    return leads.map((lead) => ({
      ...lead,
      enrolled: enrolled.has(String(lead._id)),
    }))
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    steps: v.array(stepValidator),
  },
  returns: v.id("campaigns"),
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    if (!args.name.trim()) throw new Error("Campaign name is required.")
    if (args.steps.length === 0) throw new Error("Add at least one sequence step.")

    const now = Date.now()
    const campaignId = await ctx.db.insert("campaigns", {
      name: args.name.trim(),
      description: args.description.trim(),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })

    for (let i = 0; i < args.steps.length; i++) {
      const step = args.steps[i]
      if (step.delayMinutes < 0) throw new Error("Delay cannot be negative.")
      if (step.type === "email" && !step.subject?.trim()) {
        throw new Error("Email steps need a subject.")
      }

      await ctx.db.insert("campaignSteps", {
        campaignId,
        order: i,
        type: step.type,
        delayMinutes: step.delayMinutes,
        subject: step.subject?.trim(),
        body: step.body.trim(),
        createdAt: now,
      })
    }

    return campaignId
  },
})

export const setStatus = mutation({
  args: {
    campaignId: v.id("campaigns"),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("paused")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const campaign = await ctx.db.get(args.campaignId)
    if (!campaign) throw new Error("Campaign not found.")

    await ctx.db.patch(campaign._id, {
      status: args.status,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const enroll = mutation({
  args: {
    campaignId: v.id("campaigns"),
    leadId: v.id("leads"),
  },
  returns: v.id("campaignEnrollments"),
  handler: async (ctx, args) => {
    await requireOwner(ctx)

    const campaign = await ctx.db.get(args.campaignId)
    const lead = await ctx.db.get(args.leadId)
    if (!campaign || !lead) throw new Error("Campaign or lead not found.")
    if (campaign.status !== "active") {
      throw new Error("Activate the campaign before enrolling a lead.")
    }

    const existing = await ctx.db
      .query("campaignEnrollments")
      .withIndex("by_lead_and_campaign", (q) =>
        q.eq("leadId", lead._id).eq("campaignId", campaign._id),
      )
      .first()

    if (existing?.status === "active") return existing._id

    const first = await ctx.db
      .query("campaignSteps")
      .withIndex("by_campaign_and_order", (q) => q.eq("campaignId", campaign._id))
      .order("asc")
      .first()

    if (!first) throw new Error("Campaign has no steps.")

    const now = Date.now()
    const nextRunAt = now + first.delayMinutes * 60 * 1000
    const enrollmentId =
      existing?._id ??
      (await ctx.db.insert("campaignEnrollments", {
        campaignId: campaign._id,
        leadId: lead._id,
        status: "active",
        currentStep: 0,
        nextRunAt,
        enrolledAt: now,
      }))

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        currentStep: 0,
        nextRunAt,
        stoppedAt: undefined,
        completedAt: undefined,
      })
    }

    await ctx.db.insert("campaignEvents", {
      campaignId: campaign._id,
      enrollmentId,
      leadId: lead._id,
      stepIndex: 0,
      type: "enrolled",
      detail: "Lead enrolled in campaign.",
      createdAt: now,
    })

    await ctx.db.insert("campaignEvents", {
      campaignId: campaign._id,
      enrollmentId,
      leadId: lead._id,
      stepIndex: 0,
      type: "step_scheduled",
      detail: "First step scheduled.",
      createdAt: now,
    })

    await ctx.scheduler.runAt(nextRunAt, internal.campaigns.executeStep, {
      enrollmentId,
    })

    return enrollmentId
  },
})

export const stopEnrollment = mutation({
  args: { enrollmentId: v.id("campaignEnrollments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwner(ctx)

    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment) throw new Error("Enrollment not found.")
    if (enrollment.status !== "active") return null

    const now = Date.now()
    await ctx.db.patch(enrollment._id, {
      status: "stopped",
      stoppedAt: now,
      nextRunAt: undefined,
    })

    await ctx.db.insert("campaignEvents", {
      campaignId: enrollment.campaignId,
      enrollmentId: enrollment._id,
      leadId: enrollment.leadId,
      stepIndex: enrollment.currentStep,
      type: "stopped",
      detail: "Enrollment stopped by owner.",
      createdAt: now,
    })

    return null
  },
})

export const recentEvents = query({
  args: { campaignId: v.id("campaigns") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    return await ctx.db
      .query("campaignEvents")
      .withIndex("by_campaign_and_createdAt", (q) => q.eq("campaignId", args.campaignId))
      .order("desc")
      .take(40)
  },
})

export const getExecutionContext = internalQuery({
  args: { enrollmentId: v.id("campaignEnrollments") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment) return null

    const campaign = await ctx.db.get(enrollment.campaignId)
    const lead = await ctx.db.get(enrollment.leadId)

    const step = await ctx.db
      .query("campaignSteps")
      .withIndex("by_campaign_and_order", (q) =>
        q.eq("campaignId", enrollment.campaignId),
      )
      .order("asc")
      .collect()
      .then((rows) => rows.find((row) => row.order === enrollment.currentStep) ?? null)

    return enrollment && campaign && lead && step
      ? { e: enrollment, campaign, lead, step }
      : null
  },
})

async function sendEmail(toEmail: string, subject: string, bodyText: string) {
  const cleanTo = toEmail.trim()
  const cleanSubject = subject.trim()
  const plainText = bodyText.trim()

  if (!cleanTo) throw new Error("Campaign email recipient is missing.")
  if (!cleanSubject) throw new Error("Campaign email subject is missing.")
  if (!plainText) throw new Error("Campaign email body is empty.")

  await sendGmailEmail({
    from: OWNER_EMAIL,
    to: cleanTo,
    subject: cleanSubject,
    text: plainText,
    html: buildBrandedEmailHtml({
      subject: cleanSubject,
      bodyText: plainText,
    }),
  })
}

export const executeStep = internalAction({
  args: { enrollmentId: v.id("campaignEnrollments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.campaigns.getExecutionContext, {
      enrollmentId: args.enrollmentId,
    })

    if (!data || data.e.status !== "active" || data.campaign.status !== "active") {
      return null
    }

    // A stale scheduled job must never execute a future step early.
    if (data.e.nextRunAt == null || data.e.nextRunAt > Date.now()) return null

    const { e, campaign, lead, step } = data

    try {
      if (step.type === "email") {
        await sendEmail(
          lead.email,
          step.subject ?? "Follow-up from Jabari Tech",
          step.body,
        )
      }

      if (step.type === "create_task") {
        await ctx.runMutation(internal.campaigns.createTask, {
          enrollmentId: e._id,
          leadId: lead._id,
          title: step.body,
        })
      }

      if (step.type === "add_note") {
        await ctx.runMutation(internal.campaigns.addNote, {
          enrollmentId: e._id,
          leadId: lead._id,
          body: step.body,
        })
      }

      if (step.type === "update_stage") {
        await ctx.runMutation(internal.campaigns.updateStage, {
          enrollmentId: e._id,
          leadId: lead._id,
          stage: step.body,
        })
      }

      await ctx.runMutation(internal.campaigns.advance, {
        enrollmentId: e._id,
        campaignId: campaign._id,
        leadId: lead._id,
        stepIndex: step.order,
        type: step.type,
      })
    } catch (error) {
      await ctx.runMutation(internal.campaigns.markFailed, {
        enrollmentId: e._id,
        campaignId: campaign._id,
        leadId: lead._id,
        stepIndex: step.order,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return null
  },
})

export const createTask = internalMutation({
  args: {
    enrollmentId: v.id("campaignEnrollments"),
    leadId: v.id("leads"),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.insert("workflowTasks", {
      leadId: args.leadId,
      title: args.title,
      detail: "Created by campaign sequence.",
      status: "open",
      createdAt: now,
      updatedAt: now,
    })
    return null
  },
})

export const addNote = internalMutation({
  args: {
    enrollmentId: v.id("campaignEnrollments"),
    leadId: v.id("leads"),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("crmActivities", {
      leadId: args.leadId,
      type: "note",
      title: "Campaign note",
      detail: args.body,
      createdAt: Date.now(),
    })
    return null
  },
})

export const updateStage = internalMutation({
  args: {
    enrollmentId: v.id("campaignEnrollments"),
    leadId: v.id("leads"),
    stage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const allowed = ["new", "contacted", "qualified", "won", "lost"] as const
    if (!allowed.includes(args.stage as any)) {
      throw new Error("Campaign stage must be new, contacted, qualified, won, or lost.")
    }

    const lead = await ctx.db.get(args.leadId)
    if (!lead) throw new Error("Lead not found.")

    await ctx.db.patch(lead._id, {
      status: args.stage as typeof lead.status,
      updatedAt: Date.now(),
    })

    return null
  },
})

export const advance = internalMutation({
  args: {
    enrollmentId: v.id("campaignEnrollments"),
    campaignId: v.id("campaigns"),
    leadId: v.id("leads"),
    stepIndex: v.number(),
    type: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment || enrollment.status !== "active") return null

    const now = Date.now()

    const eventType =
      args.type === "email"
        ? "email_sent"
        : args.type === "create_task"
          ? "task_created"
          : args.type === "add_note"
            ? "note_added"
            : "stage_updated"

    await ctx.db.insert("campaignEvents", {
      campaignId: args.campaignId,
      enrollmentId: enrollment._id,
      leadId: args.leadId,
      stepIndex: args.stepIndex,
      type: eventType,
      detail: "Campaign step completed.",
      createdAt: now,
    })

    const next = await ctx.db
      .query("campaignSteps")
      .withIndex("by_campaign_and_order", (q) => q.eq("campaignId", args.campaignId))
      .order("asc")
      .collect()
      .then((rows) => rows.find((row) => row.order === args.stepIndex + 1) ?? null)

    if (!next) {
      await ctx.db.patch(enrollment._id, {
        status: "completed",
        completedAt: now,
        nextRunAt: undefined,
        currentStep: args.stepIndex,
      })

      await ctx.db.insert("campaignEvents", {
        campaignId: args.campaignId,
        enrollmentId: enrollment._id,
        leadId: args.leadId,
        stepIndex: args.stepIndex,
        type: "completed",
        detail: "Campaign sequence completed.",
        createdAt: now,
      })

      return null
    }

    const nextRunAt = now + next.delayMinutes * 60 * 1000

    await ctx.db.patch(enrollment._id, {
      currentStep: next.order,
      nextRunAt,
    })

    await ctx.db.insert("campaignEvents", {
      campaignId: args.campaignId,
      enrollmentId: enrollment._id,
      leadId: args.leadId,
      stepIndex: next.order,
      type: "step_scheduled",
      detail: "Next sequence step scheduled.",
      createdAt: now,
    })

    await ctx.scheduler.runAt(nextRunAt, internal.campaigns.executeStep, {
      enrollmentId: enrollment._id,
    })

    return null
  },
})

export const markFailed = internalMutation({
  args: {
    enrollmentId: v.id("campaignEnrollments"),
    campaignId: v.id("campaigns"),
    leadId: v.id("leads"),
    stepIndex: v.number(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment) return null

    await ctx.db.patch(enrollment._id, {
      status: "stopped",
      stoppedAt: Date.now(),
      nextRunAt: undefined,
    })

    await ctx.db.insert("campaignEvents", {
      campaignId: args.campaignId,
      enrollmentId: enrollment._id,
      leadId: args.leadId,
      stepIndex: args.stepIndex,
      type: "failed",
      detail: args.error.slice(0, 500),
      createdAt: Date.now(),
    })

    return null
  },
})
