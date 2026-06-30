// app/api/migrate/route.ts — POST: generate a migrated unit from legacy source
// using Venice. Body: { name, sourceCode, sourceLang?, targetLang?,
// businessRules?, targetProfile? }. Returns { migrated_code, model }.

import { NextResponse } from "next/server";
import { veniceChat, VeniceError, stripCodeFence } from "@/lib/venice";
import { buildMigrationPrompt, type MigrationContext } from "@/lib/prompts";
import { rateLimit, clientKey } from "@/lib/rateLimit";

export async function POST(req: Request) {
  const rl = rateLimit(`migrate:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests — try again in ${rl.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Partial<MigrationContext>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    name,
    sourceCode,
    sourceLang = "COBOL",
    targetLang = "Python",
    businessRules,
    targetProfile,
    instructions,
  } = body;

  if (!name || !sourceCode) {
    return NextResponse.json(
      { error: "name and sourceCode are required" },
      { status: 400 },
    );
  }

  const { system, user } = buildMigrationPrompt({
    name,
    sourceCode,
    sourceLang,
    targetLang,
    businessRules,
    targetProfile,
    instructions,
  });

  try {
    const { content, model } = await veniceChat({
      system,
      user,
      temperature: 0.1,
      maxTokens: 8000,
    });
    return NextResponse.json({ migrated_code: stripCodeFence(content), model });
  } catch (err) {
    const status = err instanceof VeniceError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status },
    );
  }
}
