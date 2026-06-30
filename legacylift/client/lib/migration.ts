// lib/migration.ts — Client-side helpers for the on-demand "Regenerate" flow.
// These call the BACKEND's LLM endpoints (/llm/migrate, /llm/review, /llm/tests)
// over the same authenticated channel as the rest of the API. The frontend holds
// no Venice key, prompts, or SDK — all of that lives in the Python backend.

import { apiPost } from "@/lib/api";
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

export function generateMigration(
  input: GenerateInput,
): Promise<{ migrated_code: string; model: string }> {
  return apiPost("/llm/migrate", {
    name: input.name,
    source_code: input.sourceCode,
    source_lang: input.sourceLang ?? "COBOL",
    target_lang: input.targetLang ?? "Python",
    business_rules: input.businessRules ?? [],
    target_profile: input.targetProfile ?? null,
    instructions: input.instructions ?? null,
  });
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
  return apiPost("/llm/tests", {
    name: input.name,
    migrated_code: input.migratedCode,
    target_lang: input.targetLang ?? "Python",
  });
}

export async function reviewMigration(
  input: ReviewInput,
): Promise<AIReviewResult> {
  const data = await apiPost<Partial<AIReviewResult> & { confidence?: string }>(
    "/llm/review",
    {
      name: input.name,
      source_code: input.sourceCode,
      migrated_code: input.migratedCode,
      source_lang: input.sourceLang ?? "COBOL",
      target_lang: input.targetLang ?? "Python",
    },
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
