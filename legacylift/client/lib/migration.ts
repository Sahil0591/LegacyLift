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

const MAX_NAME_LENGTH = 200;
const MAX_SOURCE_CODE_LENGTH = 80_000;
const MAX_MIGRATED_CODE_LENGTH = 120_000;
const MAX_INSTRUCTIONS_LENGTH = 4_000;
const MAX_BUSINESS_RULES = 20;
const MAX_HARDCODED_VALUES = 50;

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

function truncate(value: string | undefined, max: number): string {
  return (value ?? "").slice(0, max);
}

function normalizeBusinessRules(
  rules: GenerateInput["businessRules"],
): NonNullable<GenerateInput["businessRules"]> {
  return (rules ?? []).slice(0, MAX_BUSINESS_RULES).map((rule) => ({
    title: truncate(rule.title, MAX_NAME_LENGTH),
    description: truncate(rule.description, 2000),
    hardcoded_values: (rule.hardcoded_values ?? [])
      .filter((value): value is string => typeof value === "string")
      .slice(0, MAX_HARDCODED_VALUES),
  }));
}

function normalizeTargetProfile(
  profile: GenerateInput["targetProfile"],
): GenerateInput["targetProfile"] {
  if (!profile) return null;
  return {
    language: truncate(profile.language, 64),
    version: truncate(profile.version, 32),
    test_framework: truncate(profile.test_framework, 64),
    notes: truncate(profile.notes, 1000),
  };
}

export function generateMigration(
  input: GenerateInput,
): Promise<{ migrated_code: string; model: string }> {
  const sourceCode = input.sourceCode.trim();
  if (!sourceCode) {
    throw new Error("Cannot regenerate: this chunk has no source code.");
  }
  if (sourceCode.length > MAX_SOURCE_CODE_LENGTH) {
    throw new Error(
      "Cannot regenerate: this chunk is too large for a single AI request.",
    );
  }

  return apiPost("/llm/migrate", {
    name: truncate(input.name, MAX_NAME_LENGTH),
    source_code: sourceCode,
    source_lang: input.sourceLang ?? "COBOL",
    target_lang: input.targetLang ?? "Python",
    business_rules: normalizeBusinessRules(input.businessRules),
    target_profile: normalizeTargetProfile(input.targetProfile),
    instructions: input.instructions
      ? truncate(input.instructions, MAX_INSTRUCTIONS_LENGTH)
      : null,
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
  const migratedCode = input.migratedCode.trim();
  if (!migratedCode) {
    throw new Error("Cannot generate tests: this chunk has no migrated code.");
  }
  if (migratedCode.length > MAX_MIGRATED_CODE_LENGTH) {
    throw new Error(
      "Cannot generate tests: this migrated code is too large for a single AI request.",
    );
  }

  return apiPost("/llm/tests", {
    name: truncate(input.name, MAX_NAME_LENGTH),
    migrated_code: migratedCode,
    target_lang: input.targetLang ?? "Python",
  });
}

export async function reviewMigration(
  input: ReviewInput,
): Promise<AIReviewResult> {
  const sourceCode = input.sourceCode.trim();
  const migratedCode = input.migratedCode.trim();
  if (!sourceCode || !migratedCode) {
    throw new Error("Cannot review: source and migrated code are required.");
  }
  if (
    sourceCode.length > MAX_SOURCE_CODE_LENGTH ||
    migratedCode.length > MAX_MIGRATED_CODE_LENGTH
  ) {
    throw new Error(
      "Cannot review: source or migrated code is too large for a single AI request.",
    );
  }

  const data = await apiPost<Partial<AIReviewResult> & { confidence?: string }>(
    "/llm/review",
    {
      name: truncate(input.name, MAX_NAME_LENGTH),
      source_code: sourceCode,
      migrated_code: migratedCode,
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
