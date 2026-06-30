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


def _profile_block(profile: Optional[TargetProfileCtx]) -> str:
    if not profile:
        return "Python 3.12, pytest, Decimal for money."
    parts = [
        f"{profile.get('language', 'Python')} {profile.get('version', '')}".strip(),
        f"tests: {profile['test_framework']}" if profile.get("test_framework") else None,
        profile.get("notes"),
    ]
    return " · ".join(p for p in parts if p)


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
) -> tuple[str, str]:
    system = f"""You are a principal engineer who migrates legacy {source_lang} to idiomatic, production-grade {target_lang}.

Hard requirements:
- Preserve EVERY business rule and numeric behaviour exactly. Never "improve", refactor away, or modernise the logic.
- All monetary / fixed-point arithmetic uses decimal.Decimal — never float. Reproduce COBOL "COMPUTE ... ROUNDED" with ROUND_HALF_UP.
- Add complete type hints and a one-line docstring that names the business rule being implemented.
- Keep identifiers traceable to the source (e.g. WS-INTEREST -> interest).
- Do not invent behaviour that isn't in the source.

Output ONLY the {target_lang} code for this unit. No markdown fences, no prose, no explanation."""

    guidance = ""
    if instructions and instructions.strip():
        guidance = f"\n=== REVIEWER GUIDANCE (must apply) ===\n{instructions.strip()}\n"

    user = f"""Migrate this {source_lang} unit "{name}" to {target_lang}.

=== SOURCE ({source_lang}) ===
{source_code}

=== BUSINESS RULES THIS CODE ENCODES ===
{_rules_block(business_rules)}

=== TARGET PROFILE ===
{_profile_block(target_profile)}
{guidance}
Return only the migrated {target_lang} code."""

    return system, user


def build_review_prompt(
    *,
    name: str,
    source_lang: str,
    target_lang: str,
    source_code: str,
    migrated_code: str,
) -> tuple[str, str]:
    system = f"""You are a meticulous migration reviewer. Compare a legacy {source_lang} unit with its proposed {target_lang} migration and judge SEMANTIC EQUIVALENCE — same inputs must produce the same outputs, including rounding, edge cases, and caps.

Focus on: rounding mode, integer vs decimal division, off-by-one, boundary conditions, missing caps/guards, and any business rule that was dropped or altered.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{{
  "equivalent": boolean,
  "confidence": "High" | "Medium" | "Low",
  "issues_found": number,
  "critical_issues": string[],
  "warnings": string[],
  "suggestions": string[]
}}"""

    user = f"""Unit: {name}

=== LEGACY {source_lang} ===
{source_code}

=== MIGRATED {target_lang} ===
{migrated_code}

Return only the JSON review object."""

    return system, user


def build_test_prompt(
    *,
    name: str,
    migrated_code: str,
    target_lang: str,
) -> tuple[str, str]:
    system = f"""You write {target_lang} unit tests with pytest. Given a migrated unit, produce 3-5 focused, independent test functions covering the happy path, boundary/cap conditions, and a tricky edge case. Use Decimal literals for money.

Respond with ONLY a JSON object in exactly this shape:
{{
  "tests": [ {{ "name": "test_...", "purpose": "one line" }} ],
  "code": "a complete runnable pytest module as a single string"
}}"""

    user = f"""Write pytest tests for this {target_lang} unit "{name}":

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
