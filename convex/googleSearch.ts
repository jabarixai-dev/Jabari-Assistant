function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required Convex environment variable: ${name}`)
  return value
}

type GoogleResult = {
  title: string
  url: string
  snippet: string
  source: "google"
}

function parseJsonArray(text: string): any[] {
  const cleaned = text.trim().replace(/^\`\`\`json\s*/i, "").replace(/^\`\`\`\s*/i, "").replace(/\s*\`\`\`$/i, "").trim()
  try {
    const value = JSON.parse(cleaned)
    return Array.isArray(value) ? value : []
  } catch {
    const a = cleaned.indexOf("[")
    const b = cleaned.lastIndexOf("]")
    if (a >= 0 && b > a) {
      try {
        const value = JSON.parse(cleaned.slice(a, b + 1))
        return Array.isArray(value) ? value : []
      } catch {}
    }
    return []
  }
}

function classify429(detail: string): "temporary" | "quota" | "other" {
  const lower = detail.toLowerCase()
  if (
    lower.includes("quota_exceeded") ||
    lower.includes("daily") ||
    lower.includes("per day") ||
    lower.includes("daily limit")
  ) return "quota"
  if (
    lower.includes("rate_limit_exceeded") ||
    lower.includes("too_many_requests") ||
    lower.includes("resource_exhausted") ||
    lower.includes("rate limit")
  ) return "temporary"
  return "other"
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestGoogleSearch(query: string, limit: number): Promise<Response> {
  const apiKey = requiredEnv("GEMINI_API_KEY")
  return fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `Use Google Search to research the exact query below.

SEARCH QUERY:
${query}

Return ONLY a JSON array of up to ${Math.max(1, Math.min(limit, 20))} search-result records useful for prospect discovery.
Each record must have title, url, snippet, and source. Set source to "google".
Preserve site: operators, quoted terms, OR terms, exclusions and location.
Do not invent businesses, URLs, emails, names, or snippets.
Prefer actual business/profile pages over directories, listicles, jobs, news, reviews, or generic search pages.
If a public email is visible in the result, keep it in the snippet; otherwise do not invent one.
Return [] if Google finds no useful result.`,
          }],
        }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 1,
          responseMimeType: "application/json",
        },
      }),
    },
  )
}

export async function googleSearch(query: string, limit = 10): Promise<GoogleResult[]> {
  const maxResults = Math.max(1, Math.min(limit, 20))
  let last429Detail = ""

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await requestGoogleSearch(query, maxResults)

    if (response.ok) {
      const payload: any = await response.json()
      const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("") || ""
      return parseJsonArray(text).map((row:any)=>({
        title:String(row?.title||"Untitled prospect"),
        url:String(row?.url||""),
        snippet:String(row?.snippet||""),
        source:"google" as const,
      })).filter((row:GoogleResult)=>/^https?:\/\//i.test(row.url)).slice(0,maxResults)
    }

    const detail = await response.text().catch(() => "")
    if (response.status === 401 || response.status === 403) {
      throw new Error("Google Search is not configured or the GEMINI_API_KEY is invalid.")
    }

    if (response.status === 429) {
      last429Detail = detail
      const kind = classify429(detail)
      if (kind === "quota") {
        throw new Error("Google Search daily quota is exhausted. Try again after the quota resets or increase the Google API billing tier.")
      }
      if (kind === "other") {
        throw new Error("Google Search returned a 429 response. Check the Google AI Studio usage and quota for this project.")
      }

      if (attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") || 0)
        const waitMs = retryAfter > 0
          ? Math.min(retryAfter * 1000, 8000)
          : 1000 * Math.pow(2, attempt)
        await sleep(waitMs)
        continue
      }
    }

    throw new Error(`Google Search failed (${response.status}). ${detail.slice(0, 200)}`)
  }

  throw new Error(`Google Search rate limit persisted after retries. ${last429Detail.slice(0, 120)}`)
}
