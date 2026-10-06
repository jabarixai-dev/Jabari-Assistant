import { createRemoteJWKSet, jwtVerify } from "jose"

const DEFAULT_AUTH_URL = "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth"

export function authConfig() {
  const authUrl = Netlify.env.get("NEON_AUTH_URL")?.trim() || DEFAULT_AUTH_URL
  const ownerEmail = (Netlify.env.get("OWNER_EMAIL")?.trim() || "jabari.tech.org@gmail.com").toLowerCase()
  return { authUrl, ownerEmail, jwks: createRemoteJWKSet(new URL(`${authUrl}/.well-known/jwks.json`)) }
}

export async function requireOwner(request: Request): Promise<void> {
  const { authUrl, ownerEmail, jwks } = authConfig()
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "content-type": "application/json" } })
  try {
    const { payload } = await jwtVerify(header.slice(7).trim(), jwks, { issuer: authUrl })
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : ""
    if (email !== ownerEmail) throw new Response(JSON.stringify({ error: "Owner access required" }), { status: 403, headers: { "content-type": "application/json" } })
  } catch (error) {
    if (error instanceof Response) throw error
    throw new Response(JSON.stringify({ error: "Invalid authentication token" }), { status: 401, headers: { "content-type": "application/json" } })
  }
}
