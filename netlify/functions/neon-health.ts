type HandlerEvent = {
  httpMethod: string;
};

type HandlerResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
};

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

export async function handler(_event: HandlerEvent): Promise<HandlerResponse> {
  try {
    const databaseUrl = Netlify.env.get("DATABASE_URL");

    if (!databaseUrl) {
      return {
        statusCode: 503,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ok: false,
          error: "DATABASE_URL is not configured",
        }),
      };
    }

    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(databaseUrl);
    const rows = await sql`select now() as now, current_database() as database`;

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        database: rows[0]?.database ?? null,
        now: rows[0]?.now ?? null,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Database health check failed",
      }),
    };
  }
}
