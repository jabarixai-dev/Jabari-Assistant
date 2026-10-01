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

  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  const detail = await response.text().catch(() => "")

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("SerpApi authentication failed. Check the SERPAPI_KEY configuration.")
    }
    if (response.status === 429) {
      throw new Error("SerpApi search quota or rate limit reached. Check your SerpApi account usage.")
    }
    throw new Error(`SerpApi search failed (${response.status}). ${detail.slice(0, 240)}`)
  }

  let payload: any
  try {
    payload = JSON.parse(detail)
  } catch {
    throw new Error("SerpApi returned an invalid JSON response.")
  }

  // SerpApi can return a successful response with an error message when
  // Google has no matching results. Treat that as an empty search, not a
  // lead-machine failure. Authentication, quota, and HTTP errors above
  // remain hard failures.
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
