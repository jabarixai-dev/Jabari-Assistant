import { neon } from '@neondatabase/serverless'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

const env = () => {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not configured')
  return neon(url)
}

const visitorSchema = z.object({ visitorToken: z.string().min(8) })
const messageSchema = visitorSchema.extend({
  conversationId: z.string().uuid().optional(),
  content: z.string().min(1).max(12000),
  role: z.enum(['user', 'assistant']),
})

export const ensureVisitor = createServerFn({ method: 'POST' })
  .inputValidator(visitorSchema)
  .handler(async ({ data }) => {
    const sql = env()
    const rows = await sql`INSERT INTO visitors (visitor_token) VALUES (${data.visitorToken}) ON CONFLICT (visitor_token) DO UPDATE SET last_seen = now() RETURNING id, visitor_token`
    return rows[0]
  })

export const saveChatMessage = createServerFn({ method: 'POST' })
  .inputValidator(messageSchema)
  .handler(async ({ data }) => {
    const sql = env()
    const visitor = await sql`INSERT INTO visitors (visitor_token) VALUES (${data.visitorToken}) ON CONFLICT (visitor_token) DO UPDATE SET last_seen = now() RETURNING id`
    const visitorId = visitor[0].id
    let conversationId = data.conversationId
    if (!conversationId) {
      const conversation = await sql`INSERT INTO conversations (visitor_id, title) VALUES (${visitorId}, ${data.content.slice(0, 70)}) RETURNING id`
      conversationId = conversation[0].id
    }
    const message = await sql`INSERT INTO messages (conversation_id, role, content) VALUES (${conversationId}, ${data.role}, ${data.content}) RETURNING id, conversation_id, role, content, created_at`
    await sql`UPDATE conversations SET updated_at = now() WHERE id = ${conversationId}`
    return { ...message[0], conversationId }
  })

const leadSchema = z.object({
  visitorToken: z.string().min(8),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  company: z.string().max(160).optional().default(''),
  request: z.string().min(5).max(5000),
  budget: z.string().max(120).optional().default(''),
  timeline: z.string().max(120).optional().default(''),
})

export const saveLead = createServerFn({ method: 'POST' })
  .inputValidator(leadSchema)
  .handler(async ({ data }) => {
    const sql = env()
    const visitor = await sql`INSERT INTO visitors (visitor_token) VALUES (${data.visitorToken}) ON CONFLICT (visitor_token) DO UPDATE SET last_seen = now() RETURNING id`
    const lead = await sql`INSERT INTO leads (visitor_id, name, email, company, request, budget, timeline) VALUES (${visitor[0].id}, ${data.name}, ${data.email}, ${data.company}, ${data.request}, ${data.budget}, ${data.timeline}) RETURNING id, name, email, company, status, created_at`
    return lead[0]
  })
