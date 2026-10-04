const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1"

function requiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `Missing required Convex environment variable: ${name}`,
    )
  }

  return value
}

/**
 * Gets a short-lived Gmail access token using the stored refresh token.
 */
async function getAccessToken(): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: requiredEnv("GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }).toString(),
  })

  const text = await response.text()

  let data: {
    access_token?: string
    error?: string
    error_description?: string
  } = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(
      `Google OAuth returned an invalid response (${response.status}).`,
    )
  }

  if (!response.ok || !data.access_token) {
    const details =
      data.error_description ||
      data.error ||
      `HTTP ${response.status}`

    throw new Error(`Google OAuth token refresh failed: ${details}`)
  }

  return data.access_token
}

/**
 * Makes an authenticated Gmail API request.
 */
async function gmailRequest(
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const accessToken = await getAccessToken()

  const response = await fetch(`${GMAIL_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  })

  const text = await response.text()

  let data: any = null

  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error_description ||
      data?.error?.errors?.[0]?.message ||
      `Gmail API request failed with HTTP ${response.status}.`

    throw new Error(
      `Gmail API error (${response.status}): ${message}`,
    )
  }

  return data
}

/**
 * Base64url encoding required by Gmail's messages.send endpoint.
 */
function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value)

  let binary = ""

  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + chunkSize, bytes.length),
    )

    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

/**
 * Encodes non-ASCII email headers safely.
 */
function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value
  }

  const bytes = new TextEncoder().encode(value)

  let binary = ""

  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + chunkSize, bytes.length),
    )

    binary += String.fromCharCode(...chunk)
  }

  const encoded = btoa(binary)

  return `=?UTF-8?B?${encoded}?=`
}

/**
 * Normalizes an email address before putting it into a MIME header.
 */
function cleanEmailAddress(value: string): string {
  return value.trim().replace(/[\r\n]/g, "")
}

/**
 * Prevents CRLF/header injection in email headers.
 */
function cleanHeaderValue(value: string): string {
  return value.trim().replace(/[\r\n]/g, " ")
}

/**
 * Builds a standards-compliant multipart/alternative MIME email.
 */
function buildRawEmail({
  from,
  to,
  subject,
  html,
  text,
}: {
  from: string
  to: string
  subject: string
  html: string
  text: string
}): string {
  const safeFrom = cleanEmailAddress(from)
  const safeTo = cleanEmailAddress(to)
  const safeSubject = cleanHeaderValue(subject)

  if (!safeFrom.includes("@")) {
    throw new Error("Invalid sender email address.")
  }

  if (!safeTo.includes("@")) {
    throw new Error("Invalid recipient email address.")
  }

  if (!safeSubject) {
    throw new Error("Email subject cannot be empty.")
  }

  const boundary =
    `----=_Jabari_${crypto.randomUUID().replace(/-/g, "")}`

  const safeText = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\r\n")

  const safeHtml = html
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\r\n")

  const mime = [
    `From: Jabari <${safeFrom}>`,
    `To: ${safeTo}`,
    `Subject: ${encodeHeader(safeSubject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    safeText,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    safeHtml,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n")

  return base64UrlEncode(mime)
}

/**
 * Sends an email through the Gmail API.
 */
export async function sendGmailEmail({
  from,
  to,
  subject,
  html,
  text,
}: {
  from: string
  to: string
  subject: string
  html: string
  text: string
}): Promise<void> {
  const raw = buildRawEmail({
    from,
    to,
    subject,
    html,
    text,
  })

  await gmailRequest("/users/me/messages/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw,
    }),
  })
}

export type GmailMessage = {
  id: string
  from: string
  to: string
  subject: string
  preview: string
  date: string
}

function headerValue(
  headers:
    | Array<{
        name?: string
        value?: string
      }>
    | undefined,
  name: string,
): string {
  const header = headers?.find(
    (item) =>
      String(item.name ?? "").toLowerCase() ===
      name.toLowerCase(),
  )

  return String(header?.value ?? "")
}

/**
 * Searches Gmail messages and retrieves their basic metadata.
 *
 * Requires:
 *   https://www.googleapis.com/auth/gmail.readonly
 */
export async function searchGmailEmails(
  query: string,
  maxResults = 30,
): Promise<GmailMessage[]> {
  const safeQuery = query.trim()

  if (!safeQuery) {
    return []
  }

  const capped = Math.max(
    1,
    Math.min(100, Math.floor(maxResults)),
  )

  const params = new URLSearchParams({
    q: safeQuery,
    maxResults: String(capped),
  })

  const list = await gmailRequest(
    `/users/me/messages?${params.toString()}`,
    {
      method: "GET",
    },
  )

  const ids = Array.isArray(list?.messages)
    ? list.messages
        .map((message: any) => String(message?.id ?? ""))
        .filter(Boolean)
        .slice(0, capped)
    : []

  if (ids.length === 0) {
    return []
  }

  const messages = await Promise.all(
    ids.map(async (id: string) => {
      const params = new URLSearchParams({
        format: "metadata",
      })

      params.append("metadataHeaders", "From")
      params.append("metadataHeaders", "To")
      params.append("metadataHeaders", "Subject")
      params.append("metadataHeaders", "Date")

      const message = await gmailRequest(
        `/users/me/messages/${encodeURIComponent(id)}?${params.toString()}`,
        {
          method: "GET",
        },
      )

      const headers = Array.isArray(
        message?.payload?.headers,
      )
        ? message.payload.headers
        : []

      return {
        id,
        from: headerValue(headers, "From"),
        to: headerValue(headers, "To"),
        subject: headerValue(headers, "Subject"),
        preview: String(message?.snippet ?? ""),
        date:
          headerValue(headers, "Date") ||
          String(message?.internalDate ?? ""),
      }
    }),
  )

  return messages
}
