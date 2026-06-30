// app/api/review/route.ts — POST: AI semantic review of a migrated unit using
// Venice. Body: { name, sourceCode, migratedCode, sourceLang?, targetLang? }.
// Returns an AIReviewResult-shaped object.

import { NextResponse } from "next/server";
import { veniceChat, VeniceError, parseJsonLoose } from "@/lib/venice";
import { buildReviewPrompt, type ReviewContext } from "@/lib/prompts";
import { rateLimit, clientKey } from "@/lib/rateLimit";

interface ReviewJson {
  equivalent: boolean;
  confidence: "High" | "Medium" | "Low";
  issues_found: number;
  critical_issues: string[];
  warnings: string[];
  suggestions: string[];
}

export async function POST(req: Request) {
  const rl = rateLimit(`review:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests — try again in ${rl.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: Partial<ReviewContext>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    name,
    sourceCode,
    migratedCode,
    sourceLang = "COBOL",
    targetLang = "Python",
  } = body;

  if (!name || !sourceCode || !migratedCode) {
    return NextResponse.json(
      { error: "name, sourceCode and migratedCode are required" },
      { status: 400 },
    );
  }

  const { system, user } = buildReviewPrompt({
    name,
    sourceLang,
    targetLang,
    sourceCode,
    migratedCode,
  });

  try {
    const { content } = await veniceChat({
      system,
      user,
      temperature: 0.1,
      maxTokens: 5000,
      json: true,
    });

    const parsed = parseJsonLoose<ReviewJson>(content);
    if (!parsed) {
      return NextResponse.json({
        equivalent: false,
        confidence: "Low",
        ai_confidence: "Low",
        issues_found: 1,
        critical_issues: [],
        warnings: ["Review model returned unstructured output."],
        suggestions: [],
        raw_response: content.slice(0, 1000),
      });
    }

    const issues =
      typeof parsed.issues_found === "number"
        ? parsed.issues_found
        : (parsed.critical_issues?.length ?? 0) +
          (parsed.warnings?.length ?? 0);

    return NextResponse.json({
      equivalent: Boolean(parsed.equivalent),
      confidence: parsed.confidence ?? "Medium",
      ai_confidence: parsed.confidence ?? "Medium",
      issues_found: issues,
      critical_issues: parsed.critical_issues ?? [],
      warnings: parsed.warnings ?? [],
      suggestions: parsed.suggestions ?? [],
      raw_response: "",
    });
  } catch (err) {
    const status = err instanceof VeniceError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Review failed" },
      { status },
    );
  }
}
