// lib/migration.ts — Client-side helpers for the on-demand "Regenerate" flow.
// These call the BACKEND's LLM endpoints (/llm/migrate, /llm/review, /llm/tests)
// over the same authenticated channel as the rest of the API. The frontend holds
// no Venice key, prompts, or SDK — all of that lives in the Python backend.

import { apiPost } from "@/lib/api";
import type { TargetProfilePayload } from "@/lib/targetLanguages";
import type { AIReviewResult, BusinessRule } from "@/types/legacylift";

const MAX_NAME_LENGTH = 200;
const MAX_SOURCE_CODE_LENGTH = 80_000;
const MAX_MIGRATED_CODE_LENGTH = 120_000;
const MAX_INSTRUCTIONS_LENGTH = 4_000;
const MAX_BUSINESS_RULES = 20;
const MAX_HARDCODED_VALUES = 50;
const MAX_FILE_CONTEXT_LENGTH = 60_000;
const MAX_MANIFEST_LENGTH = 8_000;
const MAX_LESSONS_LENGTH = 4_000;
const MAX_INSTITUTIONAL_CONTEXT_LENGTH = 12_000;

export interface GenerateInput {
  name: string;
  sourceCode: string;
  sourceLang?: string;
  targetLang?: string;
  businessRules?: Pick<
    BusinessRule,
    "title" | "description" | "hardcoded_values"
  >[];
  targetProfile?: TargetProfilePayload | null;
  /** Reviewer guidance applied on a regeneration. */
  instructions?: string;
  /** The chunk's last generated code — lets the model make a targeted edit
   *  instead of blind-rewriting from source, so a fix reliably sticks. */
  previousAttempt?: string;
  /** Full content of the file this chunk belongs to, for whole-file context. */
  fileContext?: string;
  /** Lightweight cross-file manifest (other filenames, deps, business rules). */
  projectManifest?: string;
  /** Accumulated lessons from past rejections/review findings for this file/project. */
  lessonsLearned?: string;
  /** Human-authored, authoritative context (project-wide + this file). */
  institutionalContext?: string;
}

export interface ReviewInput {
  name: string;
  sourceCode: string;
  migratedCode: string;
  sourceLang?: string;
  targetLang?: string;
  targetProfile?: TargetProfilePayload | null;
  institutionalContext?: string;
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

function normalizeStringList(values: string[] | undefined, cap: number): string[] {
  return (values ?? [])
    .filter((v): v is string => typeof v === "string")
    .slice(0, cap)
    .map((v) => truncate(v, 120));
}

function normalizeTargetProfile(
  profile: TargetProfilePayload | null | undefined,
): TargetProfilePayload | null {
  if (!profile) return null;
  return {
    language: truncate(profile.language, 64),
    version: truncate(profile.version, 32),
    test_framework: truncate(profile.test_framework, 64),
    notes: truncate(profile.notes, 1000),
    numeric_policy: truncate(profile.numeric_policy, 500),
    date_policy: truncate(profile.date_policy, 500),
    style_guide: truncate(profile.style_guide, 500),
    type_system: truncate(profile.type_system, 500),
    async_model: truncate(profile.async_model, 500),
    recommended_libraries: normalizeStringList(profile.recommended_libraries, 24),
    risk_focus: normalizeStringList(profile.risk_focus, 24),
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
    previous_attempt: input.previousAttempt
      ? truncate(input.previousAttempt, MAX_MIGRATED_CODE_LENGTH)
      : null,
    file_context: input.fileContext
      ? truncate(input.fileContext, MAX_FILE_CONTEXT_LENGTH)
      : null,
    project_manifest: input.projectManifest
      ? truncate(input.projectManifest, MAX_MANIFEST_LENGTH)
      : null,
    lessons_learned: input.lessonsLearned
      ? truncate(input.lessonsLearned, MAX_LESSONS_LENGTH)
      : null,
    institutional_context: input.institutionalContext
      ? truncate(input.institutionalContext, MAX_INSTITUTIONAL_CONTEXT_LENGTH)
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
  targetProfile?: TargetProfilePayload | null;
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
    target_profile: normalizeTargetProfile(input.targetProfile),
  });
}

export interface FileSummary {
  /** Developer-facing technical explanation (markdown). */
  technical: string;
  /** Plain-language explanation for non-technical readers (markdown). */
  layman: string;
}

const MAX_FILE_SUMMARY_SOURCE = 120_000;

/**
 * Ask the AI to explain what a WHOLE file does (not a single chunk), in two
 * registers — technical and plain-language — grounded in the file's extracted
 * business rules and the human-authored institutional context.
 */
export async function summarizeFile(input: {
  filename: string;
  sourceCode: string;
  sourceLang?: string;
  businessRules?: GenerateInput["businessRules"];
  institutionalContext?: string;
}): Promise<FileSummary & { model?: string }> {
  const sourceCode = input.sourceCode.trim();
  if (!sourceCode) {
    throw new Error("Cannot summarize: this file has no source code.");
  }
  if (sourceCode.length > MAX_FILE_SUMMARY_SOURCE) {
    throw new Error("This file is too large to summarize in a single AI request.");
  }
  return apiPost("/llm/summarize-file", {
    filename: truncate(input.filename, 260),
    source_code: sourceCode.slice(0, MAX_FILE_SUMMARY_SOURCE),
    source_lang: input.sourceLang ?? "COBOL",
    business_rules: normalizeBusinessRules(input.businessRules),
    institutional_context: input.institutionalContext
      ? truncate(input.institutionalContext, MAX_INSTITUTIONAL_CONTEXT_LENGTH)
      : null,
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
      target_profile: normalizeTargetProfile(input.targetProfile),
      institutional_context: input.institutionalContext
        ? truncate(input.institutionalContext, MAX_INSTITUTIONAL_CONTEXT_LENGTH)
        : null,
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
