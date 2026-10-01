import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: false, error: "API route unavailable" }, { status: 404 }),
      POST: async () => Response.json({ ok: false, error: "API route unavailable" }, { status: 404 }),
      PUT: async () => Response.json({ ok: false, error: "API route unavailable" }, { status: 404 }),
      PATCH: async () => Response.json({ ok: false, error: "API route unavailable" }, { status: 404 }),
      DELETE: async () => Response.json({ ok: false, error: "API route unavailable" }, { status: 404 }),
    },
  },
})
