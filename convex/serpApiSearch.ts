function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required Convex environment variable: ${name}`)
  return value
}

type SearchResult = {
  title: string
  url: string
  snippet: string
  source: "google"
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504])

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function serpApiSearch(query: string, limit = 10, location?: string): Promise<SearchResult[]> {
  const apiKey = requiredEnv("SERPAPI_KEY")
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: apiKey,
    output: "json",
    num: String(Math.max(1, Math.min(limit, 20))),
  })
  if (location?.trim()) params.set("location", location.trim())

  const url = `https://serpapi.com/search.json?${params.toString()}`
  let lastStatus = 0
  let lastDetail = ""

  // SerpApi can briefly return 503/5xx during provider capacity issues.
  // Retry transient failures so one short outage does not abort contact enrichment.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
    const detail = await response.text().catch(() => "")
    lastStatus = response.status
    lastDetail = detail

    if (response.ok) {
      let payload: any
      try {
        payload = JSON.parse(detail)
      } catch {
        throw new Error("SerpApi returned an invalid JSON response.")
      }

      if (payload?.error) {
        const message = String(payload.error)
        const noResults = /google hasn't returned any results|no results|did not match any results/i.test(message)
        if (noResults) return []
        throw new Error(`SerpApi search error: ${message.slice(0, 240)}`)
      }

      return (Array.isArray(payload?.organic_results) ? payload.organic_results : [])
        .map((row: any) => ({
          title: String(row?.title || "Untitled prospect"),
          url: String(row?.link || ""),
          snippet: String(row?.snippet || row?.snippet_highlighted_words?.join(" ") || ""),
          source: "google" as const,
        }))
        .filter((row: SearchResult) => /^https?:\/\//i.test(row.url))
        .slice(0, Math.max(1, Math.min(limit, 20)))
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error("SerpApi authentication failed. Check the SERPAPI_KEY configuration.")
    }

    if (!TRANSIENT_STATUSES.has(response.status) || attempt === 3) break

    await sleep(700 * 2 ** (attempt - 1))
  }

  if (lastStatus === 429) {
    throw new Error("SerpApi search quota or rate limit reached. Please try again shortly or check your SerpApi account usage.")
  }

  if (TRANSIENT_STATUSES.has(lastStatus)) {
    throw new Error(
      `SerpApi is temporarily unavailable (${lastStatus}) after 3 attempts. Please try the contact search again in a moment.` +
      (lastDetail ? ` ${lastDetail.slice(0, 180)}` : ""),
    )
  }

  throw new Error(`SerpApi search failed (${lastStatus}). ${lastDetail.slice(0, 240)}`)
}
