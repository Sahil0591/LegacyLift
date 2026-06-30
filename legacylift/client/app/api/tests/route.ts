// app/api/tests/route.ts — POST: generate pytest tests for a migrated unit
// using Venice. Body: { name, migratedCode, targetLang? }.
// Returns { tests: [{ name, purpose }], code }.

import { NextResponse } from "next/server";
import { veniceChat, VeniceError, parseJsonLoose } from "@/lib/venice";
import { buildTestPrompt, type TestContext } from "@/lib/prompts";
import { rateLimit, clientKey } from "@/lib/rateLimit";

interface TestsJson {
  tests?: { name: string; purpose?: string }[];
  code?: string;
}

export async function POST(req: Request) {
  const rl = rateLimit(`tests:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests — try again in ${rl.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Partial<TestContext>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, migratedCode, targetLang = "Python" } = body;
  if (!name || !migratedCode) {
    return NextResponse.json(
      { error: "name and migratedCode are required" },
      { status: 400 },
    );
  }

  const { system, user } = buildTestPrompt({ name, migratedCode, targetLang });

  try {
    const { content } = await veniceChat({
      system,
      user,
      temperature: 0.2,
      maxTokens: 6000,
      json: true,
    });
    const parsed = parseJsonLoose<TestsJson>(content);
    const tests = (parsed?.tests ?? [])
      .filter((t) => t && typeof t.name === "string")
      .slice(0, 8);
    return NextResponse.json({ tests, code: parsed?.code ?? "" });
  } catch (err) {
    const status = err instanceof VeniceError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Test generation failed" },
      { status },
    );
  }
}
