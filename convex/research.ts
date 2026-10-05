import { v } from "convex/values"
import { getAuthUserId } from "@convex-dev/auth/server"
import { action, internalMutation, internalQuery, query, mutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { serpApiSearch } from "./serpApiSearch"

const OWNER_EMAIL = "jabari.xai@gmail.com"

async function requireOwner(ctx: any) {
  const userId = await getAuthUserId(ctx)
  if (!userId) throw new Error("Authentication required.")
  const user = await ctx.runQuery(internal.research.getUser, { userId })
  const identity = await ctx.auth.getUserIdentity()
  const identityEmail = String((identity as any)?.email ?? "").toLowerCase()
  if (identityEmail !== OWNER_EMAIL && user?.email?.toLowerCase() !== OWNER_EMAIL) {
    throw new Error("Owner access required.")
  }
}

async function generateGeminiText(system: string, prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("Missing required Convex environment variable: GEMINI_API_KEY")

  const primary = process.env.GEMINI_MODEL || "gemini-3.8-flash"
  const fallback = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.8-flash"
  let lastError = ""

  for (const model of [...new Set([primary, fallback])]) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(model) +
          ":generateContent?key=" +
          encodeURIComponent(apiKey),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 },
          }),
        },
      )

      if (response.ok) {
        const data = await response.json() as any
        const text = String(
          data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("") || "",
        ).trim()
        if (text) return text
        throw new Error("Gemini returned an empty response.")
      }

      const detail = await response.text()
      lastError = `${model} (${response.status}): ${detail.slice(0, 500)}`

      // Retry transient provider capacity/rate failures before moving to fallback.
      if (![429, 500, 502, 503, 504].includes(response.status)) break
      if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  }

  throw new Error(`Gemini request failed after retry/fallback: ${lastError}`)
}

export const getUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => ctx.db.get(args.userId),
})

export const search = action({
  args: {
    niche: v.string(),
    location: v.string(),
    keywords: v.string(),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const niche = args.niche.trim()
    const location = args.location.trim()
    const keywords = args.keywords.trim()
    if (!niche) throw new Error("Enter a niche.")

    const platform = (args.platform ?? "Google Search").trim()
    const queryText = [niche, location, keywords, platform, "business contact"].filter(Boolean).join(" ")
    const results = await serpApiSearch(queryText, 20)
    const rows = results
      .slice(0, 20)
      .map((item: any) => ({
        query: queryText,
        name: String(item.title ?? "Untitled prospect"),
        url: String(item.url ?? ""),
        snippet: String(item.snippet ?? ""),
        source: "google",
      }))
      .filter((row: any) => row.url)

    if (rows.length) await ctx.runMutation(internal.research.saveResults, { rows })
    return { query: queryText, count: rows.length }
  },
})

function cleanQueryPart(value: string) {
  return value.replace(/["']/g, " ").replace(/\s+/g, " ").trim()
}

function expandCustomQuery(raw: string, depth: string) {
  const normalized = raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim()
  const domains = [...normalized.matchAll(/@([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase())
  const uniqueDomains = [...new Set(domains)]
  const variants = [normalized]
  if (uniqueDomains.length > 1) {
    for (const domain of uniqueDomains) {
      variants.push(
        normalized.replace(
          /"?@[a-z0-9.-]+"?(?:\s+OR\s+"?@[a-z0-9.-]+"?)+/i,
          "@" + domain,
        ),
      )
    }
  }
  const limit = depth === "Deep" ? 10 : depth === "Quick" ? 3 : 6
  return [...new Set(variants)].slice(0, limit)
}

function buildQueries(
  service: string,
  niche: string,
  location: string,
  condition: string,
  avoid: string,
  siteDomain: string,
  emailDomains: string,
) {
  const svc = cleanQueryPart(service)
  const n = cleanQueryPart(niche)
  const l = cleanQueryPart(location)
  const a = cleanQueryPart(avoid)
  const site = cleanQueryPart(siteDomain)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
  const domains = emailDomains
    .split(/[,;|\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^@/, ""))
    .filter(Boolean)
  const exclusions =
    "-jobs -hiring -career -agency -agencies -freelancer -freelance -directory -directories -yellowpages -yelp -review -reviews -news"
  const target = [n, l].filter(Boolean).map((x) => `"${x}"`).join(" ")
  const emailPart = domains.length
    ? " (" + domains.map((d) => `"@${d}"`).join(" OR ") + ")"
    : ""
  const avoidPart = a
    ? " -" + a.split(/[,;|]/).map((x) => x.trim()).filter(Boolean).join(" -")
    : ""
  const platform = site ? "site:" + site + " " : ""
  const noSite = condition === "No website" ? ' ("no website" OR "without a website")' : ""
  const weak =
    condition === "Weak/outdated website"
      ? ' ("old website" OR "outdated website" OR "broken website" OR "website not working")'
      : ""

  return [
    platform + target + " " + svc + emailPart + " " + exclusions + avoidPart,
    platform + target + " " + svc + ' ("contact" OR "email" OR "WhatsApp") ' + emailPart + " " + exclusions + avoidPart,
    target + " " + svc + ' "contact us" ' + emailPart + " " + exclusions + avoidPart,
    target + " " + svc + ' ("WhatsApp" OR "call" OR "email") ' + emailPart + " " + exclusions + avoidPart,
    target + " " + svc + noSite + weak + " " + exclusions + avoidPart,
    'intitle:"' + n + '" ' + (l ? `"${l}" ` : "") + svc + " contact " + emailPart + " " + exclusions + avoidPart,
  ]
    .filter(Boolean)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .slice(0, 7)
}

function canonicalUrl(raw: string) {
  try {
    const u = new URL(raw)
    u.hash = ""
    u.search = ""
    return u.toString().replace(/\/$/, "").toLowerCase()
  } catch {
    return raw.trim().toLowerCase()
  }
}

function isIndependentWebsite(raw: string) {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "")
    const excluded = [
      "facebook.com",
      "instagram.com",
      "linkedin.com",
      "tiktok.com",
      "x.com",
      "twitter.com",
      "youtube.com",
      "wa.me",
      "whatsapp.com",
    ]
    return Boolean(host) && !excluded.some((d) => host === d || host.endsWith("." + d))
  } catch {
    return false
  }
}

function candidateIsNoise(row: any, avoidTerms: string) {
  const hay = (String(row.name) + " " + String(row.url) + " " + String(row.snippet)).toLowerCase()
  const path = String(row.url).toLowerCase()
  const defaults = [
    "directory", "yellow pages", "business listing", "company listings",
    "list of businesses", "find businesses", "top 10", "top 20",
    "ranking", "rankings", "news", "jobs", "job board", "hiring",
    "career", "events/", "/blog/", "/news/", "/category/", "/tag/",
    "/rankings/", "/directory/", "upwork.com", "fiverr.com",
    "freelancer.com", "clutch.co", "yelp.com",
  ]
  const custom = avoidTerms.split(/[,;|]/).map((x) => x.trim().toLowerCase()).filter(Boolean)
  return [...defaults, ...custom].some((x) => x && hay.includes(x)) || path.includes("/search?")
}

type WebsiteCheck = {
  status: "found" | "not_found" | "failed"
  evidence: Array<{ title: string; url: string; snippet: string }>
  error?: string
}

async function websiteCrossCheck(name: string, location: string): Promise<WebsiteCheck> {
  const q = [`"${name}"`, location ? `"${location}"` : "", '"official website"']
    .filter(Boolean)
    .join(" ")

  try {
    const results = await serpApiSearch(q, 10)
    const independent = results.filter((x: any) => isIndependentWebsite(String(x.url || "")))
    return {
      status: independent.length ? "found" : "not_found",
      evidence: independent.slice(0, 5).map((x: any) => ({
        title: String(x.title || ""),
        url: String(x.url || ""),
        snippet: String(x.snippet || ""),
      })),
    }
  } catch (error) {
    return {
      status: "failed",
      evidence: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const leadMachine = action({
  args: {
    service: v.string(),
    niche: v.string(),
    location: v.string(),
    condition: v.string(),
    avoid: v.string(),
    siteDomain: v.optional(v.string()),
    emailDomains: v.optional(v.string()),
    customQuery: v.optional(v.string()),
    searchDepth: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx)

    const service = args.service.trim()
    const niche = args.niche.trim()
    const location = args.location.trim()
    const condition = args.condition.trim() || "Either"
    const avoid = args.avoid.trim()
    const siteDomain = (args.siteDomain || "instagram.com").trim()
    const emailDomains = (args.emailDomains || "gmail.com yahoo.com hotmail.com outlook.com aol.com").trim()
    const customQuery = (args.customQuery || "").trim()
    const searchDepth = (args.searchDepth || "Standard").trim()

    if (!service || !niche) throw new Error("Enter what you sell and who you want to reach.")

    const baseQueries = customQuery
      ? expandCustomQuery(customQuery, searchDepth)
      : buildQueries(service, niche, location, condition, avoid, siteDomain, emailDomains)
    const expandedQueries =
      customQuery && location && !customQuery.toLowerCase().includes(location.toLowerCase())
        ? baseQueries.map((q) => `${q} "${cleanQueryPart(location)}"`)
        : baseQueries

    const queryLimit = searchDepth === "Quick" ? 2 : searchDepth === "Deep" ? 5 : 3
    const queries = expandedQueries.slice(0, queryLimit)
    const candidates: any[] = []

    for (const queryText of queries) {
      const perQueryLimit = searchDepth === "Quick" ? 10 : searchDepth === "Deep" ? 20 : 15
      const results = await serpApiSearch(queryText, perQueryLimit, location || undefined)
      for (const item of results.slice(0, perQueryLimit)) {
        const row = {
          query: queryText,
          name: String(item.title ?? "Untitled prospect"),
          url: String(item.url ?? ""),
          snippet: String(item.snippet ?? ""),
          source: "google",
        }
        if (!row.url || candidateIsNoise(row, avoid)) continue
        candidates.push(row)
      }
    }

    const unique: any[] = []
    const seen = new Set<string>()
    const maxResults = searchDepth === "Deep" ? 60 : searchDepth === "Quick" ? 30 : 40

    for (const row of candidates) {
      const key = canonicalUrl(row.url)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(row)
      if (unique.length >= maxResults) break
    }

    if (!unique.length) {
      return { queries: queries.length, serpSearches: queries.length, results: 0, qualified: 0, review: 0 }
    }

    // Save raw Serp results immediately. Analysis is a separate explicit step.
    const now = Date.now()
    await ctx.runMutation(internal.research.saveResults, { rows: unique })

    const needsWebsiteCheck = (row: any) =>
      !isIndependentWebsite(row.url) && condition !== "Any potential buyer"

    const crossChecked: any[] = []
    const checkLimit = searchDepth === "Quick" ? 1 : searchDepth === "Deep" ? 6 : 3

    for (const row of unique.filter(needsWebsiteCheck).slice(0, checkLimit)) {
      const check = await websiteCrossCheck(row.name, location)
      crossChecked.push({ ...row, websiteCheck: check })
    }

    const checkedMap = new Map(crossChecked.map((x: any) => [canonicalUrl(x.url), x]))
    const rows: any[] = []
    let qualified = 0
    let review = 0

    for (const row of unique) {
      const directWebsite = isIndependentWebsite(row.url)
      const evidenceRow = checkedMap.get(canonicalUrl(row.url))
      const check: WebsiteCheck | undefined = evidenceRow?.websiteCheck
      const websiteEvidence = check?.evidence || []
      const websiteFound = directWebsite || check?.status === "found"

      let websiteStatus: any = "unknown"
      if (directWebsite || check?.status === "found") websiteStatus = "has_website"
      else if (check?.status === "not_found") websiteStatus = condition === "No website" ? "no_website" : "unknown"

      const conditionMatches =
        condition === "No website"
          ? websiteStatus === "no_website"
          : condition === "Weak/outdated website"
            ? websiteStatus === "weak_or_broken"
            : condition === "Either"
              ? ["no_website", "weak_or_broken"].includes(websiteStatus)
              : true

      const qualifies = condition === "No website" && check?.status === "failed"
        ? false
        : conditionMatches

      if (qualifies) qualified++
      else review++

      rows.push({
        ...row,
        targetService: service,
        targetNiche: niche,
        targetLocation: location,
        targetCondition: condition,
        avoidTerms: avoid,
        qualificationStatus: qualifies ? "qualified" : "review",
        qualificationReason: qualifies
          ? "Matched the selected search criteria."
          : check?.status === "failed"
            ? "Website check failed, so this prospect was left for manual review instead of being treated as having no website."
            : "Requires manual review against the selected website condition.",
        websiteStatus,
        websiteEvidence,
        websiteFound,
        status: "research",
        createdAt: now,
        updatedAt: now,
      })
    }

    if (rows.length) await ctx.runMutation(internal.research.saveQualifiedResults, { rows })

    return {
      queries: queries.length,
      serpSearches: queries.length + crossChecked.length,
      results: rows.length,
      qualified,
      review,
    }
  },
})

export const saveResults = internalMutation({
  args: {
    rows: v.array(v.object({
      query: v.string(),
      name: v.string(),
      url: v.string(),
      snippet: v.string(),
      source: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    for (const row of args.rows) {
      const existing = await ctx.db.query("prospects").withIndex("by_url", (q) => q.eq("url", row.url)).first()
      if (existing) {
        await ctx.db.patch(existing._id, {
          query: row.query,
          name: row.name,
          url: row.url,
          snippet: row.snippet,
          source: row.source,
          updatedAt: now,
        })
      } else {
        const id = await ctx.db.insert("prospects", {
          ...row,
          status: "research",
          targetService: "",
          targetNiche: "",
          targetLocation: "",
          targetCondition: "",
          avoidTerms: "",
          qualificationStatus: "unknown",
          qualificationReason: "",
          websiteStatus: "unknown",
          analysisStatus: "pending",
          contactStatus: "not_checked",
          createdAt: now,
          updatedAt: now,
        })
        await ctx.db.insert("outreachEvents", {
          kind: "prospect_researched",
          prospectId: id,
          metadata: { query: row.query, source: row.source },
          createdAt: now,
        })
      }
    }
  },
})

export const saveQualifiedResults = internalMutation({
  args: { rows: v.array(v.any()) },
  handler: async (ctx, args) => {
    const now = Date.now()

    for (const row of args.rows) {
      const existing = await ctx.db.query("prospects").withIndex("by_url", (q) => q.eq("url", row.url)).first()
      const patch: any = {
        query: String(row.query),
        name: String(row.name),
        url: String(row.url),
        snippet: String(row.snippet),
        source: String(row.source),
        targetService: String(row.targetService ?? ""),
        targetNiche: String(row.targetNiche ?? ""),
        targetLocation: String(row.targetLocation ?? ""),
        targetCondition: String(row.targetCondition ?? ""),
        avoidTerms: String(row.avoidTerms ?? ""),
        qualificationStatus: row.qualificationStatus,
        qualificationReason: String(row.qualificationReason ?? ""),
        websiteStatus: row.websiteStatus,
        websiteEvidence: Array.isArray(row.websiteEvidence) ? row.websiteEvidence : [],
        websiteFound: Boolean(row.websiteFound),
        updatedAt: now,
      }

      if (existing) {
        await ctx.db.patch(existing._id, patch)
      } else {
        const id = await ctx.db.insert("prospects", {
          ...patch,
          status: "research",
          analysisStatus: "pending",
          contactStatus: "not_checked",
          createdAt: now,
        })
        await ctx.db.insert("outreachEvents", {
          kind: "prospect_researched",
          prospectId: id,
          metadata: {
            query: row.query,
            qualification: row.qualificationStatus,
            websiteStatus: row.websiteStatus,
          },
          createdAt: now,
        })
      }
    }
  },
})

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx)
    return await ctx.db.query("prospects")
      .withIndex("by_status_and_updatedAt")
      .order("desc")
      .take(50)
  },
})

export const updateStatus = mutation({
  args: {
    prospectId: v.id("prospects"),
    status: v.union(v.literal("research"), v.literal("saved"), v.literal("discarded")),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    await ctx.db.patch(args.prospectId, { status: args.status, updatedAt: Date.now() })
  },
})

function parseObject(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const a = cleaned.indexOf("{")
    const b = cleaned.lastIndexOf("}")
    if (a >= 0 && b > a) {
      try { return JSON.parse(cleaned.slice(a, b + 1)) } catch {}
    }
    return {}
  }
}

export const analyze = action({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const prospect = await ctx.runQuery(internal.research.getProspect, { prospectId: args.prospectId })
    if (!prospect) throw new Error("Prospect not found.")

    await ctx.runMutation(internal.research.markAnalysis, { prospectId: args.prospectId, status: "pending" })

    try {
      const extra = await serpApiSearch(
        `"${prospect.name}" "${prospect.url}" contact email owner founder about`,
        10,
      )

      const resultText = await generateGeminiText(
        "You are Jabari Tech prospect intelligence analyst. Use ONLY the supplied prospect and search evidence. Return ONLY valid JSON with keys email, phone, contact, fit, pain, subject, body. email must be an explicitly displayed public email or empty. phone must be an explicitly displayed public phone number or empty. contact must be an explicitly displayed person/name or empty. Never infer contact details from domains or names. fit must explain why this specific business is a plausible buyer for the requested service, grounded in evidence. pain must describe a specific website/digital opportunity visible from evidence; if insufficient, say so. subject must be concise and specific. body must be a short respectful personalized outreach email. Never claim no website as certainty; say I could not find an independent website in the public results I checked when appropriate. Never invent pricing, clients, results, previous contact, or facts.",
        JSON.stringify({ prospect, additionalSearch: extra }),
      )

      const obj = parseObject(resultText)
      const email = normalizeEmail(String(obj.email || ""))
      const phone = normalizePhone(String(obj.phone || ""), prospect.targetLocation)
      const contact = String(obj.contact || "").trim()
      const fit = String(obj.fit || "").trim() || String(prospect.qualificationReason || "This business matches the selected prospect criteria.")
      const pain = String(obj.pain || "").trim() ||
        ((prospect.websiteStatus === "no_website" || prospect.websiteStatus === "social_only")
          ? "Public search evidence points to a social-first presence without an independent website surfaced in this research."
          : "A specific website opportunity needs manual review.")
      const subject = String(obj.subject || "").trim() || "Website opportunity for " + prospect.name
      const body = String(obj.body || "").trim() ||
        ("Hello" + (contact ? " " + contact : "") + ",\n\nI came across " + prospect.name +
          " while researching " + (prospect.targetNiche || "local businesses") + " in " +
          (prospect.targetLocation || "your area") +
          ". I could not find an independent website in the public results I checked. I build practical websites for businesses that want a stronger online presence.\n\nIf this is something you are considering, I would be happy to share a few ideas.\n\nBest,\nJabari Tech")

      await ctx.runMutation(internal.research.saveAnalysis, {
        prospectId: args.prospectId,
        contactEmail: email || undefined,
        contactPhone: phone || undefined,
        contactName: contact || undefined,
        fitReason: fit,
        painPoint: pain,
        outreachSubject: subject,
        outreachBody: body,
        status: "ready",
      })
      await ctx.runMutation(internal.research.recordAnalyzed, {
        prospectId: args.prospectId,
        hasEmail: Boolean(email),
      })

      return { success: true, hasEmail: Boolean(email), hasPhone: Boolean(phone) }
    } catch (error) {
      await ctx.runMutation(internal.research.markAnalysis, {
        prospectId: args.prospectId,
        status: "failed",
      })
      throw error
    }
  },
})

export const recordAnalyzed = internalMutation({
  args: { prospectId: v.id("prospects"), hasEmail: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("outreachEvents", {
      kind: "prospect_analyzed",
      prospectId: args.prospectId,
      metadata: { hasEmail: args.hasEmail },
      createdAt: Date.now(),
    })
    return null
  },
})

export const getProspect = internalQuery({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, args) => ctx.db.get(args.prospectId),
})

export const markAnalysis = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.prospectId, { analysisStatus: args.status, updatedAt: Date.now() })
  },
})

export const saveAnalysis = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    contactName: v.optional(v.string()),
    fitReason: v.string(),
    painPoint: v.string(),
    outreachSubject: v.string(),
    outreachBody: v.string(),
    status: v.literal("ready"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const hasContact = Boolean(args.contactEmail || args.contactPhone)
    const patch: any = {
      fitReason: args.fitReason,
      painPoint: args.painPoint,
      outreachSubject: args.outreachSubject,
      outreachBody: args.outreachBody,
      analysisStatus: args.status,
      contactStatus: hasContact ? "verified" : "no_contact",
      updatedAt: now,
    }
    if (args.contactEmail) patch.contactEmail = args.contactEmail
    if (args.contactPhone) patch.contactPhone = args.contactPhone
    if (args.contactName) patch.contactName = args.contactName
    if (hasContact) {
      patch.contactSource = "Public search evidence from prospect analysis"
      patch.contactEvidence = "The contact detail was explicitly surfaced in the public search evidence used during analysis."
      patch.contactCheckedAt = now
    }
    await ctx.db.patch(args.prospectId, patch)
  },
})

function normalizePhone(value: string, location?: string) {
  const raw = String(value || "").trim()
  if (!raw) return null
  let digits = raw.replace(/[^0-9]/g, "")
  if (digits.startsWith("00")) digits = digits.slice(2)
  if (digits.startsWith("0") && /nigeria/i.test(String(location || ""))) digits = "234" + digits.slice(1)
  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

function normalizeEmail(value: string) {
  const m = value.trim().toLowerCase().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return m?.[0] || null
}

export const enrichContact = action({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const p = await ctx.runQuery(internal.research.getProspect, { prospectId: args.prospectId })
    if (!p) throw new Error("Prospect not found.")

    if (p.contactEmail || p.contactPhone) {
      const checkedAt = Date.now()
      await ctx.runMutation(internal.research.saveContact, {
        prospectId: args.prospectId,
        contactEmail: p.contactEmail,
        contactPhone: p.contactPhone,
        contactName: p.contactName,
        contactSource: p.contactSource || "Public search evidence from prospect analysis",
        contactEvidence: p.contactEvidence || "Contact detail was explicitly displayed in the public search evidence used during analysis.",
        status: "verified",
        checkedAt,
      })
      return { status: "verified", email: p.contactEmail || null, phone: p.contactPhone || null }
    }

    await ctx.runMutation(internal.research.setContactStatus, {
      prospectId: args.prospectId,
      status: "needs_review",
      checkedAt: Date.now(),
    })

    const qs = [
      `"${p.name}" "${p.url}" email phone`,
      `"${p.name}" "${p.url}" founder owner email phone`,
      `"${p.url}" contact phone`,
      `"${p.name}" "contact us" email phone`,
    ]

    try {
      const results: any[] = []
      for (const q of qs) results.push(...await serpApiSearch(q, 8))

      const rText = await generateGeminiText(
        "Extract only publicly displayed contact details. Never infer anything. Return exactly EMAIL:, PHONE:, CONTACT:, SOURCE:, EVIDENCE:. Leave EMAIL and PHONE blank if none is explicit.",
        JSON.stringify({ prospect: p, results }),
      )

      const pick = (label: string) =>
        rText.match(new RegExp(`^\\s*${label}:\\s*(.*?)(?=\\n(?:EMAIL|PHONE|CONTACT|SOURCE|EVIDENCE):|$)`, "is"))?.[1]?.trim() || ""

      const email = normalizeEmail(pick("EMAIL"))
      const phone = normalizePhone(pick("PHONE"), p.targetLocation)
      const contact = pick("CONTACT")
      const source = pick("SOURCE")
      const evidence = pick("EVIDENCE")
      const status =
        (email || phone) && source && evidence
          ? "verified"
          : (email || phone || contact || source || evidence)
            ? "needs_review"
            : "no_contact"

      await ctx.runMutation(internal.research.saveContact, {
        prospectId: args.prospectId,
        contactEmail: email || undefined,
        contactPhone: phone || undefined,
        contactName: contact || undefined,
        contactSource: source || undefined,
        contactEvidence: evidence || undefined,
        status,
        checkedAt: Date.now(),
      })

      return { status, email: email || null, phone: phone || null }
    } catch (error) {
      await ctx.runMutation(internal.research.setContactStatus, {
        prospectId: args.prospectId,
        status: "needs_review",
        checkedAt: Date.now(),
      })
      throw error
    }
  },
})

export const setContactStatus = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    status: v.union(v.literal("not_checked"), v.literal("verified"), v.literal("no_contact"), v.literal("needs_review")),
    checkedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.prospectId, {
      contactStatus: args.status,
      contactCheckedAt: args.checkedAt,
      updatedAt: args.checkedAt,
    })
  },
})

export const saveContact = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactSource: v.optional(v.string()),
    contactEvidence: v.optional(v.string()),
    status: v.union(v.literal("not_checked"), v.literal("verified"), v.literal("no_contact"), v.literal("needs_review")),
    checkedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const patch: any = {
      contactStatus: args.status,
      contactCheckedAt: args.checkedAt,
      updatedAt: args.checkedAt,
    }
    if (args.contactEmail) patch.contactEmail = args.contactEmail
    if (args.contactPhone) patch.contactPhone = args.contactPhone
    if (args.contactName) patch.contactName = args.contactName
    if (args.contactSource) patch.contactSource = args.contactSource
    if (args.contactEvidence) patch.contactEvidence = args.contactEvidence
    await ctx.db.patch(args.prospectId, patch)

    const kind =
      args.status === "verified"
        ? "contact_verified"
        : args.status === "no_contact"
          ? "contact_not_found"
          : "contact_review_needed"

    await ctx.db.insert("outreachEvents", {
      kind,
      prospectId: args.prospectId,
      metadata: {
        hasEmail: Boolean(args.contactEmail),
        hasPhone: Boolean(args.contactPhone),
        source: args.contactSource || null,
      },
      createdAt: args.checkedAt,
    })
  },
})

export const convertToContact = mutation({
  args: { prospectId: v.id("prospects") },
  returns: v.object({ contactId: v.id("contacts"), created: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const p = await ctx.db.get(args.prospectId)
    if (!p) throw new Error("Prospect not found.")

    const email = p.contactEmail?.trim().toLowerCase()
    const phone = p.contactPhone?.trim()
    if (!email && !phone) throw new Error("Verify a public email or phone before adding this prospect to CRM.")

    let contact: any = email
      ? await ctx.db.query("contacts").withIndex("by_email", (q) => q.eq("email", email)).first()
      : null

    if (!contact && phone) {
      const rows = await ctx.db.query("contacts").withIndex("by_updatedAt").order("desc").take(500)
      contact = rows.find((x: any) => x.phone === phone)
    }

    const now = Date.now()
    if (contact) {
      await ctx.db.patch(contact._id, {
        name: p.contactName || contact.name,
        phone: phone || contact.phone,
        email: email || contact.email,
        company: contact.company || p.name,
        website: contact.website || p.url,
        updatedAt: now,
      })
      await ctx.db.insert("crmActivities", {
        contactId: contact._id,
        type: "note",
        title: "Prospect linked to CRM",
        detail: "Converted from prospect research: " + p.name,
        createdAt: now,
      })
      return { contactId: contact._id, created: false }
    }

    const contactId = await ctx.db.insert("contacts", {
      name: p.contactName || p.name,
      email: email || "unknown@local.invalid",
      company: p.name,
      phone: phone || undefined,
      website: p.url,
      source: "prospect_research",
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert("crmActivities", {
      contactId,
      type: "note",
      title: "Prospect added to CRM",
      detail: "Added from prospect research: " + p.name,
      createdAt: now,
    })
    return { contactId, created: true }
  },
})

async function deleteProspectData(ctx: any, id: any) {
  const drafts = await ctx.db.query("prospectOutreachDrafts")
    .withIndex("by_prospectId_and_updatedAt", (q: any) => q.eq("prospectId", id))
    .collect()
  for (const d of drafts) await ctx.db.delete(d._id)

  const events = await ctx.db.query("outreachEvents")
    .withIndex("by_createdAt")
    .order("desc")
    .take(500)
  for (const e of events) if (e.prospectId === id) await ctx.db.delete(e._id)

  await ctx.db.delete(id)
}

export const deleteProspect = mutation({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, args) => {
    await requireOwner(ctx)
    const prospect = await ctx.db.get(args.prospectId)
    if (!prospect) return { deleted: 0 }
    await deleteProspectData(ctx, args.prospectId)
    return { deleted: 1 }
  },
})

export const clearResearchHistory = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx)
    const rows = await ctx.db.query("prospects")
      .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "research"))
      .take(500)
    for (const p of rows) await deleteProspectData(ctx, p._id)
    return { deleted: rows.length }
  },
})

export const clearProspectsHistory = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx)
    const rows = await ctx.db.query("prospects").take(500)
    const deletable = rows.filter(
      (p: any) => p.status !== "saved" && !(p.contactStatus === "verified" && Boolean(p.contactEmail || p.contactPhone)),
    )
    for (const p of deletable) await deleteProspectData(ctx, p._id)
    return { deleted: deletable.length, protected: rows.length - deletable.length }
  },
})
