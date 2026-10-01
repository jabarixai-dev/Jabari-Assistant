import { neon } from "@neondatabase/serverless";

export type NeonSql = ReturnType<typeof neon>;

let cachedSql: NeonSql | null = null;

function getDatabaseUrl() {
  const value =
    import.meta.env.VITE_NEON_DATABASE_URL ||
    import.meta.env.VITE_DATABASE_URL ||
    import.meta.env.DATABASE_URL;

  if (!value) {
    throw new Error(
      "Neon database connection is not configured. Set DATABASE_URL on the server."
    );
  }

  return value;
}

/**
 * Server-side Neon client.
 *
 * This module intentionally does not replace Convex yet. During migration,
 * individual feature modules can move to Neon while the existing Convex
 * modules continue serving the rest of the application.
 */
export function getNeonSql(): NeonSql {
  if (!cachedSql) {
    cachedSql = neon(getDatabaseUrl());
  }

  return cachedSql;
}

export async function neonHealthCheck() {
  const sql = getNeonSql();
  const rows = await sql`select now() as now, current_database() as database`;
  return rows[0] ?? null;
}
