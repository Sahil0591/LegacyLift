"""
utils/migration_prompts.py — Prompt builders + JSON helpers for the on-demand
"Regenerate" endpoints (POST /llm/migrate, /llm/review, /llm/tests).

This is the Python port of what used to live in the Next.js client as
`lib/prompts.ts` + the JSON-parsing helpers in `lib/venice.ts`. Venice now lives
exclusively in the backend, so the frontend never sees a prompt or a secret.

All three builders return a (system, user) tuple suitable for LLMClient.complete.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional, TypedDict


# ---------------------------------------------------------------------------
# Lightweight context shapes (mirrors the old TS interfaces)
# ---------------------------------------------------------------------------

class BusinessRuleCtx(TypedDict, total=False):
    title: str
    description: str
    hardcoded_values: list[str]


class TargetProfileCtx(TypedDict, total=False):
    language: str
    version: str
    test_framework: str
    notes: str
    # Rich, per-language guidance sourced from the client target-language
    # catalog (client/lib/targetLanguages.ts, itself ported from
    # core/layer0_5/target_profile_registry.py). Optional so older/thin
    # callers still work.
    numeric_policy: str
    date_policy: str
    style_guide: str
    type_system: str
    async_model: str
    recommended_libraries: list[str]
    risk_focus: list[str]


# ---------------------------------------------------------------------------
# Block helpers
# ---------------------------------------------------------------------------

def _rules_block(rules: Optional[list[BusinessRuleCtx]]) -> str:
    if not rules:
        return "None supplied."
    lines = []
    for i, r in enumerate(rules):
        title = r.get("title", "")
        description = r.get("description", "")
        values = r.get("hardcoded_values") or []
        suffix = f" (values: {', '.join(values)})" if values else ""
        lines.append(f"{i + 1}. {title} — {description}{suffix}")
    return "\n".join(lines)


def _profile_block(profile: Optional[TargetProfileCtx], target_lang: str) -> str:
    if not profile:
        # Nothing but the target language name to go on — still give the model
        # the language-agnostic invariants so it never silently assumes Python.
        return (
            f"{target_lang} — write idiomatic {target_lang}. Use the language's "
            "exact-decimal type for money (never binary float) and its "
            "conventional unit-test framework."
        )

    header = f"{profile.get('language', target_lang)} {profile.get('version', '')}".strip()
    lines: list[str] = [header] if header else []

    def add(label: str, key: str) -> None:
        value = profile.get(key)
        if value:
            lines.append(f"- {label}: {value}")

    add("Money / numerics", "numeric_policy")
    add("Dates / time", "date_policy")
    add("Typing", "type_system")
    add("Style", "style_guide")
    add("Concurrency", "async_model")
    add("Tests", "test_framework")

    libs = profile.get("recommended_libraries")
    if libs:
        lines.append(f"- Recommended libraries: {', '.join(libs)}")
    focus = profile.get("risk_focus")
    if focus:
        lines.append(f"- Watch for: {', '.join(focus)}")

    notes = profile.get("notes")
    if notes:
        lines.append(f"- Notes: {notes}")

    return "\n".join(lines)


def _test_framework(profile: Optional[TargetProfileCtx], target_lang: str) -> str:
    """The unit-test framework to write in — from the profile, else a sane
    default keyed off the target language name."""
    if profile and profile.get("test_framework"):
        return profile["test_framework"]
    defaults = {
        "python": "pytest",
        "java": "JUnit 5",
        "c#": "xUnit",
        "csharp": "xUnit",
        "c++": "GoogleTest",
        "cpp": "GoogleTest",
        "rust": "cargo test",
        "sql": "tSQLt / utPLSQL",
        "go": "go test",
        "typescript": "vitest",
    }
    return defaults.get(target_lang.strip().casefold(), f"the standard {target_lang} test framework")


def _org_context_block(institutional_context: Optional[str]) -> str:
    """The human-authored, authoritative organization context (project-wide +
    per-file). Rendered near the top so the model weights it heavily."""
    if not institutional_context or not institutional_context.strip():
        return ""
    return (
        "\n=== ORGANIZATION CONTEXT (authored by the team — authoritative; overrides "
        "generic assumptions, but never break business-rule or numeric equivalence) ===\n"
        f"{institutional_context.strip()}\n"
    )


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def build_migration_prompt(
    *,
    name: str,
    source_code: str,
    source_lang: str,
    target_lang: str,
    business_rules: Optional[list[BusinessRuleCtx]] = None,
    target_profile: Optional[TargetProfileCtx] = None,
    instructions: Optional[str] = None,
    previous_attempt: Optional[str] = None,
    file_context: Optional[str] = None,
    project_manifest: Optional[str] = None,
    lessons_learned: Optional[str] = None,
    institutional_context: Optional[str] = None,
) -> tuple[str, str]:
    system = f"""You are a principal engineer who migrates legacy {source_lang} to idiomatic, production-grade {target_lang}.

Hard requirements:
- Preserve EVERY business rule and numeric behaviour exactly. Never "improve", refactor away, or modernise the logic.
- Money and fixed-point arithmetic MUST use {target_lang}'s exact-decimal type — never binary floating point. Preserve the source's rounding semantics exactly (e.g. COBOL "COMPUTE ... ROUNDED" is round-half-up). Follow the TARGET PROFILE's numeric guidance for the concrete type and API.
- Follow the TARGET PROFILE for typing, dates, style, concurrency, and the test framework. Write idiomatic {target_lang} — do not transliterate {source_lang} constructs that have a natural {target_lang} equivalent.
- Add a one-line doc comment naming the business rule being implemented, in {target_lang}'s conventional comment/doc style.
- Keep identifiers traceable to the source (e.g. WS-INTEREST -> interest).
- Do not invent behaviour that isn't in the source.
- When an ORGANIZATION CONTEXT block is present, treat it as authoritative: honour its systems, conventions, and constraints. It overrides generic assumptions — but never at the cost of business-rule or numeric equivalence.

Output ONLY the {target_lang} code for this unit. No markdown fences, no prose, no explanation."""

    org_block = _org_context_block(institutional_context)

    guidance = ""
    if instructions and instructions.strip():
        guidance = f"\n=== REVIEWER GUIDANCE (must apply) ===\n{instructions.strip()}\n"

    previous_block = ""
    if previous_attempt and previous_attempt.strip():
        previous_block = (
            f"\n=== YOUR PREVIOUS ATTEMPT ===\n{previous_attempt.strip()}\n"
            "Edit the previous attempt to satisfy the reviewer guidance below. "
            "Keep everything else about it identical — do not rewrite from scratch.\n"
        )

    file_block = ""
    if file_context and file_context.strip():
        file_block = (
            f"\n=== FULL SOURCE FILE (context only — migrate ONLY the unit above) ===\n"
            f"{file_context.strip()}\n"
        )

    manifest_block = ""
    if project_manifest and project_manifest.strip():
        manifest_block = (
            f"\n=== PROJECT MANIFEST (other files, dependencies, extracted rules) ===\n"
            f"{project_manifest.strip()}\n"
        )

    lessons_block = ""
    if lessons_learned and lessons_learned.strip():
        lessons_block = (
            f"\n=== LESSONS FROM PAST REVIEWS (do not repeat these mistakes) ===\n"
            f"{lessons_learned.strip()}\n"
        )

    user = f"""Migrate this {source_lang} unit "{name}" to {target_lang}.
{org_block}
=== SOURCE ({source_lang}) ===
{source_code}
{file_block}
=== BUSINESS RULES THIS CODE ENCODES ===
{_rules_block(business_rules)}
{manifest_block}{lessons_block}
=== TARGET PROFILE ({target_lang}) ===
{_profile_block(target_profile, target_lang)}
{previous_block}{guidance}
Return only the migrated {target_lang} code."""

    return system, user


def build_review_prompt(
    *,
    name: str,
    source_lang: str,
    target_lang: str,
    source_code: str,
    migrated_code: str,
    target_profile: Optional[TargetProfileCtx] = None,
    institutional_context: Optional[str] = None,
) -> tuple[str, str]:
    system = f"""You are a meticulous migration reviewer. Compare a legacy {source_lang} unit with its proposed {target_lang} migration and judge SEMANTIC EQUIVALENCE — same inputs must produce the same outputs, including rounding, edge cases, and caps.

Focus on: rounding mode, integer vs decimal division, off-by-one, boundary conditions, missing caps/guards, and any business rule that was dropped or altered. Judge the code as idiomatic {target_lang} (see TARGET PROFILE) — do NOT flag correct {target_lang} idioms as issues merely because they read differently from the {source_lang}. When an ORGANIZATION CONTEXT block is present, treat its stated conventions and constraints as intended — do not report them as problems.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{{
  "equivalent": boolean,
  "confidence": "High" | "Medium" | "Low",
  "issues_found": number,
  "critical_issues": string[],
  "warnings": string[],
  "suggestions": string[]
}}"""

    org_block = _org_context_block(institutional_context)

    user = f"""Unit: {name}
{org_block}
=== TARGET PROFILE ({target_lang}) ===
{_profile_block(target_profile, target_lang)}

=== LEGACY {source_lang} ===
{source_code}

=== MIGRATED {target_lang} ===
{migrated_code}

Return only the JSON review object."""

    return system, user


def build_project_review_prompt(
    *,
    project_name: str,
    manifest: str,
    file_summaries: list[dict],
) -> tuple[str, str]:
    system = """You are reviewing a completed legacy-code-to-target-language migration at the \
WHOLE-PROJECT level. You are given a manifest of files, their dependency edges, and \
extracted business rules — NOT the full migrated code for every file. Flag ONLY \
cross-file concerns: naming/style inconsistency across files, constants or business \
rules duplicated in more than one file, dependency-ordering issues (a file migrated \
before something it depends on), or files that reference each other but may not have \
been reviewed together. Do NOT invent per-line bugs you cannot see.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "summary": string,
  "risk_notes": string[],
  "cross_file_concerns": string[],
  "confidence": "High" | "Medium" | "Low"
}"""

    summary_lines = "\n".join(
        f"- {f.get('filename', '?')}: {f.get('chunk_count', 0)} units, risk {f.get('risk_level', '?')}"
        for f in file_summaries
    )

    user = f"""Project: {project_name}

=== FILES ===
{summary_lines or "No files supplied."}

=== PROJECT MANIFEST (dependencies + extracted business rules) ===
{manifest or "No manifest supplied."}

Return only the JSON review object."""

    return system, user


def build_file_summary_prompt(
    *,
    filename: str,
    source_lang: str,
    source_code: str,
    business_rules: Optional[list[BusinessRuleCtx]] = None,
    institutional_context: Optional[str] = None,
) -> tuple[str, str]:
    """Explain what an ENTIRE legacy file does (not a single chunk) in two
    registers: technical (for engineers) and plain-language (for non-technical
    stakeholders). Grounded in the code, extracted rules, and org context."""
    system = f"""You are a staff engineer who explains what a legacy {source_lang} file does. Produce TWO summaries of the SAME file, aimed at different readers:

1. "technical" — for software engineers. Cover the file's responsibilities, its key routines/paragraphs/sections, the data it reads and writes, control flow, external side effects (files, databases, calls to other programs), and any notable risks or edge cases. Use correct {source_lang} and domain terminology. Be precise.

2. "layman" — for non-technical stakeholders (product, compliance, operations). Explain, in plain language with NO code jargon, what business function this file performs, when it runs, and why it matters. Focus on outcomes and rules, not implementation.

Ground BOTH summaries in the actual code plus the provided business rules and organization context. Do NOT invent behaviour that isn't in the source. If something is unclear from the code, say so rather than guessing. Use short markdown (a lead sentence then a few bullet points) in each.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{{
  "technical": "markdown string",
  "layman": "markdown string"
}}"""

    org_block = _org_context_block(institutional_context)

    user = f"""File: {filename} ({source_lang})
{org_block}
=== BUSINESS RULES DETECTED IN THIS FILE ===
{_rules_block(business_rules)}

=== SOURCE ({source_lang}) ===
{source_code}

Return only the JSON object with "technical" and "layman" keys."""

    return system, user


def build_test_prompt(
    *,
    name: str,
    migrated_code: str,
    target_lang: str,
    target_profile: Optional[TargetProfileCtx] = None,
) -> tuple[str, str]:
    framework = _test_framework(target_profile, target_lang)
    system = f"""You write {target_lang} unit tests using {framework}. Given a migrated unit, produce 3-5 focused, independent tests covering the happy path, boundary/cap conditions, and a tricky edge case. Use {target_lang}'s exact-decimal type for monetary values — never binary floating point.

Respond with ONLY a JSON object in exactly this shape:
{{
  "tests": [ {{ "name": "...", "purpose": "one line" }} ],
  "code": "a complete runnable {framework} test module as a single string"
}}"""

    user = f"""Write {framework} tests for this {target_lang} unit "{name}":

{migrated_code}

Return only the JSON object."""

    return system, user


# ---------------------------------------------------------------------------
# Output parsing — the model may wrap code in fences or JSON in prose.
# ---------------------------------------------------------------------------

_FENCE_RE = re.compile(r"^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$")


def strip_code_fence(text: str) -> str:
    """Strip a leading/trailing markdown code fence if the model added one."""
    t = text.strip()
    m = _FENCE_RE.match(t)
    return (m.group(1) if m else t).strip()


def parse_json_loose(text: str) -> Optional[dict[str, Any]]:
    """Best-effort parse of a JSON object the model may have wrapped in prose."""
    cleaned = strip_code_fence(text)
    try:
        return json.loads(cleaned)
    except (ValueError, TypeError):
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except (ValueError, TypeError):
                return None
        return None
