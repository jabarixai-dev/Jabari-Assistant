import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";
import { fireTrigger, processDue } from "./workflow-engine";

const AUTH_URL =
  "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";

const JWKS_URL =
  "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";

const OWNER_EMAIL = "jabari.tech.org@gmail.com";

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function db() {
  const url = Netlify.env.get("DATABASE_URL");

  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }

  return neon(url);
}

async function owner(request: Request) {
  const h = request.headers.get("authorization");

  if (!h?.startsWith("Bearer ")) {
    throw new Response(
      JSON.stringify({ error: "Authentication required" }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }

  const v = await jwtVerify(h.slice(7).trim(), jwks, {
    issuer: AUTH_URL,
  });

  const email =
    typeof v.payload.email === "string"
      ? v.payload.email.toLowerCase()
      : "";

  if (email !== OWNER_EMAIL) {
    throw new Response(
      JSON.stringify({ error: "Owner access required" }),
      {
        status: 403,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }
}

function normalizeFields(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter(
      (f: any) =>
        f &&
        typeof f.key === "string" &&
        typeof f.label === "string",
    )
    .map((f: any) => ({
      key: f.key,
      label: f.label,
      type: [
        "text",
        "email",
        "phone",
        "textarea",
        "company",
      ].includes(f.type)
        ? f.type
        : "text",
      required: Boolean(f.required),
    }));
}

export default async (request: Request) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "list";
    const sql = db();

    if (
      ["list", "create", "status", "submissions"].includes(action)
    ) {
      await owner(request);
    }

    if (request.method === "GET" && action === "list") {
      const rows = await sql`
        select
          id,
          name,
          description,
          status,
          fields,
          source,
          created_at as "createdAt",
          updated_at as "updatedAt"
        from lead_forms
        order by updated_at desc
        limit 50
      `;

      return json({
        ok: true,
        forms: rows,
      });
    }

    if (
      request.method === "GET" &&
      action === "submissions"
    ) {
      const formId = String(
        url.searchParams.get("formId") ?? "",
      );

      const rows = await sql`
        select
          id,
          form_id as "formId",
          name,
          email,
          phone,
          company,
          message,
          raw_fields as "rawFields",
          lead_id as "leadId",
          status,
          created_at as "createdAt"
        from form_submissions
        where form_id = ${formId}
        order by created_at desc
        limit 100
      `;

      return json({
        ok: true,
        submissions: rows,
      });
    }

    if (
      request.method === "POST" &&
      action === "create"
    ) {
      const b = (await request.json()) as any;

      const name = String(b.name ?? "").trim();

      if (!name) {
        return json(
          {
            ok: false,
            error: "Form name is required.",
          },
          400,
        );
      }

      const now = Date.now();
      const id = crypto.randomUUID();

      await sql`
        insert into lead_forms
          (
            id,
            name,
            description,
            status,
            fields,
            source,
            created_at,
            updated_at
          )
        values
          (
            ${id},
            ${name},
            ${String(b.description ?? "").trim()},
            'draft',
            ${JSON.stringify(normalizeFields(b.fields))}::jsonb,
            'website_form',
            ${now},
            ${now}
          )
      `;

      return json({
        ok: true,
        id,
      });
    }

    if (
      request.method === "POST" &&
      action === "status"
    ) {
      const b = (await request.json()) as any;

      const id = String(b.formId ?? "");
      const status = String(b.status ?? "");

      if (
        !["draft", "published", "paused"].includes(status)
      ) {
        return json(
          {
            ok: false,
            error: "Invalid form status.",
          },
          400,
        );
      }

      await sql`
        update lead_forms
        set
          status = ${status},
          updated_at = ${Date.now()}
        where id = ${id}
      `;

      return json({
        ok: true,
      });
    }

    if (
      request.method === "GET" &&
      action === "public"
    ) {
      const id = String(
        url.searchParams.get("formId") ?? "",
      );

      const rows = await sql`
        select
          id,
          name,
          description,
          status,
          fields
        from lead_forms
        where id = ${id}
          and status = 'published'
        limit 1
      `;

      const row = rows[0] ?? null;

      return json({
        ok: true,
        form: row,
      });
    }

    if (
      request.method === "POST" &&
      action === "submit"
    ) {
      const b = (await request.json()) as any;

      const formId = String(b.formId ?? "");
      const source = String(
        b.source ?? "website_form",
      ).slice(0, 120);

      const formRows = await sql`
        select *
        from lead_forms
        where id = ${formId}
          and status = 'published'
        limit 1
      `;

      const form = formRows[0] as any;

      if (!form) {
        return json(
          {
            ok: false,
            error: "This form is not available.",
          },
          404,
        );
      }

      if (String(b.honeypot ?? "").trim()) {
        return json(
          {
            ok: false,
            error: "Submission rejected.",
          },
          400,
        );
      }

      const values =
        b.values &&
        typeof b.values === "object"
          ? b.values
          : {};

      const get = (k: string) =>
        String(values[k] ?? "").trim();

      const fields = Array.isArray(form.fields)
        ? form.fields
        : JSON.parse(String(form.fields ?? "[]"));

      for (const f of fields) {
        if (f.required && !get(f.key)) {
          return json(
            {
              ok: false,
              error: f.label + " is required.",
            },
            400,
          );
        }
      }

      const email = get("email").toLowerCase();
      const name = get("name");
      const phone = get("phone");
      const company = get("company");
      const message =
        get("message") || get("request");

      if (!name || !email.includes("@")) {
        return json(
          {
            ok: false,
            error:
              "A valid name and email are required.",
          },
          400,
        );
      }

      const now = Date.now();
      const sessionId = crypto.randomUUID();
      const threadId = crypto.randomUUID();
      const leadId = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      const submissionId = crypto.randomUUID();

      await sql`
        insert into anonymous_sessions
          (
            id,
            capability,
            created_at,
            expires_at,
            remaining_messages
          )
        values
          (
            ${sessionId},
            ${"form:" + formId + ":" + now},
            ${now},
            ${now + 86400000},
            0
          )
      `;

      await sql`
        insert into chat_threads
          (
            id,
            session_id,
            title,
            created_at,
            updated_at,
            next_order
          )
        values
          (
            ${threadId},
            ${sessionId},
            ${"Form submission: " + name},
            ${now},
            ${now},
            1
          )
      `;

      await sql`
        insert into leads
          (
            id,
            thread_id,
            name,
            email,
            company,
            request,
            budget,
            timeline,
            status,
            created_at,
            updated_at
          )
        values
          (
            ${leadId},
            ${threadId},
            ${name},
            ${email},
            ${company},
            ${message || "Website form enquiry"},
            '',
            '',
            'new',
            ${now},
            ${now}
          )
      `;

      await sql`
        insert into contacts
          (
            id,
            name,
            email,
            company,
            phone,
            source,
            lead_id,
            created_at,
            updated_at
          )
        values
          (
            ${contactId},
            ${name},
            ${email},
            ${company},
            ${phone || null},
            ${source},
            ${leadId},
            ${now},
            ${now}
          )
      `;

      await sql`
        insert into crm_activities
          (
            id,
            contact_id,
            lead_id,
            type,
            title,
            detail,
            created_at
          )
        values
          (
            ${crypto.randomUUID()},
            ${contactId},
            ${leadId},
            'lead_created',
            'Lead captured from form',
            ${form.name +
              " · " +
              (message || "Website form enquiry")},
            ${now}
          )
      `;

      await sql`
        insert into form_submissions
          (
            id,
            form_id,
            name,
            email,
            phone,
            company,
            message,
            raw_fields,
            lead_id,
            status,
            created_at
          )
        values
          (
            ${submissionId},
            ${formId},
            ${name},
            ${email},
            ${phone || null},
            ${company},
            ${message || ""},
            ${JSON.stringify(values)}::jsonb,
            ${leadId},
            'processed',
            ${now}
          )
      `;

      const workflow = await fireTrigger(
        sql as any,
        "form_submitted",
        leadId,
        "new",
      );

      const processed = await processDue(
        sql as any,
      );

      return json({
        ok: true,
        submissionId,
        leadId,
        workflow,
        processed,
      });
    }

    return json(
      {
        ok: false,
        error: "Unknown form action.",
      },
      400,
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(
      "Lead forms API error",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Lead forms request failed",
      },
      500,
    );
  }
};

export const config: Config = {
  path: "/api/lead-forms",
};import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { neon } from "@neondatabase/serverless";
import { fireTrigger, processDue } from "./workflow-engine";

const AUTH_URL =
  "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth";

const JWKS_URL =
  "https://ep-polished-term-b5053umh.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json";

const OWNER_EMAIL = "jabari.tech.org@gmail.com";

const jwks = createRemoteJWKSet(new URL(JWKS_URL));

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function db() {
  const url = Netlify.env.get("DATABASE_URL");

  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }

  return neon(url);
}

async function owner(request: Request) {
  const h = request.headers.get("authorization");

  if (!h?.startsWith("Bearer ")) {
    throw new Response(
      JSON.stringify({ error: "Authentication required" }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }

  const v = await jwtVerify(h.slice(7).trim(), jwks, {
    issuer: AUTH_URL,
  });

  const email =
    typeof v.payload.email === "string"
      ? v.payload.email.toLowerCase()
      : "";

  if (email !== OWNER_EMAIL) {
    throw new Response(
      JSON.stringify({ error: "Owner access required" }),
      {
        status: 403,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }
}

function normalizeFields(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter(
      (f: any) =>
        f &&
        typeof f.key === "string" &&
        typeof f.label === "string",
    )
    .map((f: any) => ({
      key: f.key,
      label: f.label,
      type: [
        "text",
        "email",
        "phone",
        "textarea",
        "company",
      ].includes(f.type)
        ? f.type
        : "text",
      required: Boolean(f.required),
    }));
}

export default async (request: Request) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") ?? "list";
    const sql = db();

    if (
      ["list", "create", "status", "submissions"].includes(action)
    ) {
      await owner(request);
    }

    if (request.method === "GET" && action === "list") {
      const rows = await sql`
        select
          id,
          name,
          description,
          status,
          fields,
          source,
          created_at as "createdAt",
          updated_at as "updatedAt"
        from lead_forms
        order by updated_at desc
        limit 50
      `;

      return json({
        ok: true,
        forms: rows,
      });
    }

    if (
      request.method === "GET" &&
      action === "submissions"
    ) {
      const formId = String(
        url.searchParams.get("formId") ?? "",
      );

      const rows = await sql`
        select
          id,
          form_id as "formId",
          name,
          email,
          phone,
          company,
          message,
          raw_fields as "rawFields",
          lead_id as "leadId",
          status,
          created_at as "createdAt"
        from form_submissions
        where form_id = ${formId}
        order by created_at desc
        limit 100
      `;

      return json({
        ok: true,
        submissions: rows,
      });
    }

    if (
      request.method === "POST" &&
      action === "create"
    ) {
      const b = (await request.json()) as any;

      const name = String(b.name ?? "").trim();

      if (!name) {
        return json(
          {
            ok: false,
            error: "Form name is required.",
          },
          400,
        );
      }

      const now = Date.now();
      const id = crypto.randomUUID();

      await sql`
        insert into lead_forms
          (
            id,
            name,
            description,
            status,
            fields,
            source,
            created_at,
            updated_at
          )
        values
          (
            ${id},
            ${name},
            ${String(b.description ?? "").trim()},
            'draft',
            ${JSON.stringify(normalizeFields(b.fields))}::jsonb,
            'website_form',
            ${now},
            ${now}
          )
      `;

      return json({
        ok: true,
        id,
      });
    }

    if (
      request.method === "POST" &&
      action === "status"
    ) {
      const b = (await request.json()) as any;

      const id = String(b.formId ?? "");
      const status = String(b.status ?? "");

      if (
        !["draft", "published", "paused"].includes(status)
      ) {
        return json(
          {
            ok: false,
            error: "Invalid form status.",
          },
          400,
        );
      }

      await sql`
        update lead_forms
        set
          status = ${status},
          updated_at = ${Date.now()}
        where id = ${id}
      `;

      return json({
        ok: true,
      });
    }

    if (
      request.method === "GET" &&
      action === "public"
    ) {
      const id = String(
        url.searchParams.get("formId") ?? "",
      );

      const rows = await sql`
        select
          id,
          name,
          description,
          status,
          fields
        from lead_forms
        where id = ${id}
          and status = 'published'
        limit 1
      `;

      const row = rows[0] ?? null;

      return json({
        ok: true,
        form: row,
      });
    }

    if (
      request.method === "POST" &&
      action === "submit"
    ) {
      const b = (await request.json()) as any;

      const formId = String(b.formId ?? "");
      const source = String(
        b.source ?? "website_form",
      ).slice(0, 120);

      const formRows = await sql`
        select *
        from lead_forms
        where id = ${formId}
          and status = 'published'
        limit 1
      `;

      const form = formRows[0] as any;

      if (!form) {
        return json(
          {
            ok: false,
            error: "This form is not available.",
          },
          404,
        );
      }

      if (String(b.honeypot ?? "").trim()) {
        return json(
          {
            ok: false,
            error: "Submission rejected.",
          },
          400,
        );
      }

      const values =
        b.values &&
        typeof b.values === "object"
          ? b.values
          : {};

      const get = (k: string) =>
        String(values[k] ?? "").trim();

      const fields = Array.isArray(form.fields)
        ? form.fields
        : JSON.parse(String(form.fields ?? "[]"));

      for (const f of fields) {
        if (f.required && !get(f.key)) {
          return json(
            {
              ok: false,
              error: f.label + " is required.",
            },
            400,
          );
        }
      }

      const email = get("email").toLowerCase();
      const name = get("name");
      const phone = get("phone");
      const company = get("company");
      const message =
        get("message") || get("request");

      if (!name || !email.includes("@")) {
        return json(
          {
            ok: false,
            error:
              "A valid name and email are required.",
          },
          400,
        );
      }

      const now = Date.now();
      const sessionId = crypto.randomUUID();
      const threadId = crypto.randomUUID();
      const leadId = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      const submissionId = crypto.randomUUID();

      await sql`
        insert into anonymous_sessions
          (
            id,
            capability,
            created_at,
            expires_at,
            remaining_messages
          )
        values
          (
            ${sessionId},
            ${"form:" + formId + ":" + now},
            ${now},
            ${now + 86400000},
            0
          )
      `;

      await sql`
        insert into chat_threads
          (
            id,
            session_id,
            title,
            created_at,
            updated_at,
            next_order
          )
        values
          (
            ${threadId},
            ${sessionId},
            ${"Form submission: " + name},
            ${now},
            ${now},
            1
          )
      `;

      await sql`
        insert into leads
          (
            id,
            thread_id,
            name,
            email,
            company,
            request,
            budget,
            timeline,
            status,
            created_at,
            updated_at
          )
        values
          (
            ${leadId},
            ${threadId},
            ${name},
            ${email},
            ${company},
            ${message || "Website form enquiry"},
            '',
            '',
            'new',
            ${now},
            ${now}
          )
      `;

      await sql`
        insert into contacts
          (
            id,
            name,
            email,
            company,
            phone,
            source,
            lead_id,
            created_at,
            updated_at
          )
        values
          (
            ${contactId},
            ${name},
            ${email},
            ${company},
            ${phone || null},
            ${source},
            ${leadId},
            ${now},
            ${now}
          )
      `;

      await sql`
        insert into crm_activities
          (
            id,
            contact_id,
            lead_id,
            type,
            title,
            detail,
            created_at
          )
        values
          (
            ${crypto.randomUUID()},
            ${contactId},
            ${leadId},
            'lead_created',
            'Lead captured from form',
            ${form.name +
              " · " +
              (message || "Website form enquiry")},
            ${now}
          )
      `;

      await sql`
        insert into form_submissions
          (
            id,
            form_id,
            name,
            email,
            phone,
            company,
            message,
            raw_fields,
            lead_id,
            status,
            created_at
          )
        values
          (
            ${submissionId},
            ${formId},
            ${name},
            ${email},
            ${phone || null},
            ${company},
            ${message || ""},
            ${JSON.stringify(values)}::jsonb,
            ${leadId},
            'processed',
            ${now}
          )
      `;

      const workflow = await fireTrigger(
        sql as any,
        "form_submitted",
        leadId,
        "new",
      );

      const processed = await processDue(
        sql as any,
      );

      return json({
        ok: true,
        submissionId,
        leadId,
        workflow,
        processed,
      });
    }

    return json(
      {
        ok: false,
        error: "Unknown form action.",
      },
      400,
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(
      "Lead forms API error",
      error,
    );

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Lead forms request failed",
      },
      500,
    );
  }
};

export const config: Config = {
  path: "/api/lead-forms",
};
