// lib/migration.ts — Client-side helpers that call the Venice-backed API routes
// (/api/migrate, /api/review). Safe to import from client components.

import type {
  AIReviewResult,
  BusinessRule,
  TargetProfile,
} from "@/types/legacylift";

export interface GenerateInput {
  name: string;
  sourceCode: string;
  sourceLang?: string;
  targetLang?: string;
  businessRules?: Pick<
    BusinessRule,
    "title" | "description" | "hardcoded_values"
  >[];
  targetProfile?: Pick<
    TargetProfile,
    "language" | "version" | "test_framework" | "notes"
  > | null;
  /** Reviewer guidance applied on a regeneration. */
  instructions?: string;
}

export interface ReviewInput {
  name: string;
  sourceCode: string;
  migratedCode: string;
  sourceLang?: string;
  targetLang?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status})`,
    );
  }
  return data as T;
}

export function generateMigration(
  input: GenerateInput,
): Promise<{ migrated_code: string; model: string }> {
  return postJson("/api/migrate", input);
}

export interface GeneratedTests {
  tests: { name: string; purpose?: string }[];
  code: string;
}

export function generateTests(input: {
  name: string;
  migratedCode: string;
  targetLang?: string;
}): Promise<GeneratedTests> {
  return postJson("/api/tests", input);
}

export async function reviewMigration(
  input: ReviewInput,
): Promise<AIReviewResult> {
  const data = await postJson<Partial<AIReviewResult> & { confidence?: string }>(
    "/api/review",
    input,
  );
  return {
    issues_found: data.issues_found ?? 0,
    critical_issues: data.critical_issues ?? [],
    warnings: data.warnings ?? [],
    suggestions: data.suggestions ?? [],
    ai_confidence: data.ai_confidence ?? data.confidence ?? "Medium",
    raw_response: data.raw_response ?? "",
  };
}
