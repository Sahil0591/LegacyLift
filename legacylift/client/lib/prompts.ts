// lib/prompts.ts — Prompt builders for the Venice-backed migration + review.
// Shared by the /api/migrate and /api/review route handlers.

import type { BusinessRule, TargetProfile } from "@/types/legacylift";

export interface MigrationContext {
  name: string;
  sourceCode: string;
  sourceLang: string;
  targetLang: string;
  businessRules?: Pick<
    BusinessRule,
    "title" | "description" | "hardcoded_values"
  >[];
  targetProfile?: Pick<
    TargetProfile,
    "language" | "version" | "test_framework" | "notes"
  > | null;
  /** Optional reviewer guidance for a regeneration ("use banker's rounding", …). */
  instructions?: string;
}

function rulesBlock(rules?: MigrationContext["businessRules"]): string {
  if (!rules || rules.length === 0) return "None supplied.";
  return rules
    .map(
      (r, i) =>
        `${i + 1}. ${r.title} — ${r.description}` +
        (r.hardcoded_values?.length
          ? ` (values: ${r.hardcoded_values.join(", ")})`
          : ""),
    )
    .join("\n");
}

function profileBlock(profile?: MigrationContext["targetProfile"]): string {
  if (!profile) return `${"Python"} 3.12, pytest, Decimal for money.`;
  return [
    `${profile.language} ${profile.version}`,
    profile.test_framework ? `tests: ${profile.test_framework}` : null,
    profile.notes,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function buildMigrationPrompt(ctx: MigrationContext): {
  system: string;
  user: string;
} {
  const system = `You are a principal engineer who migrates legacy ${ctx.sourceLang} to idiomatic, production-grade ${ctx.targetLang}.

Hard requirements:
- Preserve EVERY business rule and numeric behaviour exactly. Never "improve", refactor away, or modernise the logic.
- All monetary / fixed-point arithmetic uses decimal.Decimal — never float. Reproduce COBOL "COMPUTE ... ROUNDED" with ROUND_HALF_UP.
- Add complete type hints and a one-line docstring that names the business rule being implemented.
- Keep identifiers traceable to the source (e.g. WS-INTEREST -> interest).
- Do not invent behaviour that isn't in the source.

Output ONLY the ${ctx.targetLang} code for this unit. No markdown fences, no prose, no explanation.`;

  const user = `Migrate this ${ctx.sourceLang} unit "${ctx.name}" to ${ctx.targetLang}.

=== SOURCE (${ctx.sourceLang}) ===
${ctx.sourceCode}

=== BUSINESS RULES THIS CODE ENCODES ===
${rulesBlock(ctx.businessRules)}

=== TARGET PROFILE ===
${profileBlock(ctx.targetProfile)}
${
  ctx.instructions && ctx.instructions.trim()
    ? `\n=== REVIEWER GUIDANCE (must apply) ===\n${ctx.instructions.trim()}\n`
    : ""
}
Return only the migrated ${ctx.targetLang} code.`;

  return { system, user };
}

export interface ReviewContext {
  name: string;
  sourceLang: string;
  targetLang: string;
  sourceCode: string;
  migratedCode: string;
}

export function buildReviewPrompt(ctx: ReviewContext): {
  system: string;
  user: string;
} {
  const system = `You are a meticulous migration reviewer. Compare a legacy ${ctx.sourceLang} unit with its proposed ${ctx.targetLang} migration and judge SEMANTIC EQUIVALENCE — same inputs must produce the same outputs, including rounding, edge cases, and caps.

Focus on: rounding mode, integer vs decimal division, off-by-one, boundary conditions, missing caps/guards, and any business rule that was dropped or altered.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "equivalent": boolean,
  "confidence": "High" | "Medium" | "Low",
  "issues_found": number,
  "critical_issues": string[],
  "warnings": string[],
  "suggestions": string[]
}`;

  const user = `Unit: ${ctx.name}

=== LEGACY ${ctx.sourceLang} ===
${ctx.sourceCode}

=== MIGRATED ${ctx.targetLang} ===
${ctx.migratedCode}

Return only the JSON review object.`;

  return { system, user };
}

export interface TestContext {
  name: string;
  migratedCode: string;
  targetLang: string;
}

export function buildTestPrompt(ctx: TestContext): {
  system: string;
  user: string;
} {
  const system = `You write ${ctx.targetLang} unit tests with pytest. Given a migrated unit, produce 3-5 focused, independent test functions covering the happy path, boundary/cap conditions, and a tricky edge case. Use Decimal literals for money.

Respond with ONLY a JSON object in exactly this shape:
{
  "tests": [ { "name": "test_...", "purpose": "one line" } ],
  "code": "a complete runnable pytest module as a single string"
}`;

  const user = `Write pytest tests for this ${ctx.targetLang} unit "${ctx.name}":

${ctx.migratedCode}

Return only the JSON object.`;

  return { system, user };
}
