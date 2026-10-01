import { getNeonAuthToken } from "./neon-auth";

export async function neonFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getNeonAuthToken();
  if (!token) throw new Error("Neon session unavailable. Please sign in again.");

  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(path, { ...options, headers });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export async function neonApi<T>(
  resource: string,
  options: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const { query, ...request } = options;
  const params = new URLSearchParams({ resource });
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, value);
  }
  return neonFetch<T>(`/api/crm?${params.toString()}`, request);
}
