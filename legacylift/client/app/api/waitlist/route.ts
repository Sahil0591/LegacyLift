// app/api/waitlist/route.ts - Neon fallback for the waitlist.
//
// The browser tries Formspree first; this route is only hit when that fails, so
// the database is touched as little as possible. It uses Neon's SQL-over-HTTP
// driver (a single fetch per query, no connection pool to keep warm) and:
//   - creates the table at most once per warm instance (module-level guard),
//   - de-duplicates by email via ON CONFLICT (no wasted rows, no read-first),
//   - caps every field length and returns a tiny JSON body,
// which keeps data transfer to the few hundred bytes an insert actually needs.
//
// Requires DATABASE_URL (the plain Neon postgres connection string) in the
// Vercel project env. Missing/!configured => 503 so the client can surface it.

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// Never prerender; always run per-request on the server.
export const dynamic = "force-dynamic";

// Guards the one-time CREATE TABLE per warm serverless instance.
let schemaReady = false;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length ? trimmed : null;
}

export async function POST(req: Request) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const email = clean(b.email, 320);
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { ok: false, error: "invalid_email" },
      { status: 422 },
    );
  }
  const name = clean(b.name, 200);
  const company = clean(b.company, 200);
  const useCase = clean(b.use_case, 2000);

  try {
    const sql = neon(url);
    if (!schemaReady) {
      await sql`
        CREATE TABLE IF NOT EXISTS waitlist_signups (
          id          BIGSERIAL PRIMARY KEY,
          email       TEXT NOT NULL UNIQUE,
          name        TEXT,
          company     TEXT,
          use_case    TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      schemaReady = true;
    }
    await sql`
      INSERT INTO waitlist_signups (email, name, company, use_case)
      VALUES (${email}, ${name}, ${company}, ${useCase})
      ON CONFLICT (email) DO NOTHING
    `;
    return NextResponse.json({ ok: true });
  } catch {
    // Don't leak driver/DB internals to the client.
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
  }
}
