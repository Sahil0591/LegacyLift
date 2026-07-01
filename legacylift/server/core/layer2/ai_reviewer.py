"""
core/layer2/ai_reviewer.py — adversarial AI semantic reviewer (Layer 2).

Layer 2 is the expensive semantic quality gate.  It runs after Layer 1
(deterministic static analysis) and uses the Venice AI LLM to find behaviour
differences between the original legacy code and the migrated Python that
cheap structural checks cannot catch.

Design principle: adversarial, not helpful.
Layer 2 does NOT improve the migration.  Its sole job is to find differences
in behaviour.  If it finds nothing, it must justify that conclusion category
by category — it cannot simply declare "no issues found".

Pipeline position:
  run_migration_generation() in pipeline.py calls the module-level review()
  after static_analysis_complete fires.

  MigrationPipeline.run_layer2() calls AIReviewer.review(chunk) for the
  full class-based pipeline — kept for backward compatibility.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from rich.console import Console

from models.business_rule import BusinessRule
from models.chunk import MigrationChunk
from models.chunk import AIReviewResult as _LegacyAIReviewResult
from utils.code_parser import CodeChunk
from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)
console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


# ---------------------------------------------------------------------------
# Data contracts
# ---------------------------------------------------------------------------

@dataclass
class AIReviewInput:
    chunk: CodeChunk          # original parsed chunk from Layer 0
    migrated_code: str        # the proposed Python migration
    business_rule: BusinessRule   # confirmed rule — the specification
    static_analysis: Any      # StaticAnalysisResult (Pydantic or dataclass)
    source_language: str      # "cobol" | "java"


@dataclass
class AIReviewIssue:
    category: str        # "arithmetic" | "date_time" | "string_handling" |
                         # "null_handling" | "rounding" | "loop_boundary" |
                         # "exception_handling" | "other"
    severity: str        # "critical" | "moderate" | "minor"
    description: str
    original_behaviour: str
    migrated_behaviour: str
    suggested_fix: Optional[str] = None


@dataclass
class AIReviewResult:
    issues_found: int
    issues: list[AIReviewIssue]
    reviewer_confidence: str      # "High" | "Medium" | "Low"
    reviewer_summary: str
    checked_categories: list[str]
    review_time_seconds: float
    retry_recommended: bool       # True if any critical issue found


# ---------------------------------------------------------------------------
# Adversarial prompt
# ---------------------------------------------------------------------------

_ADVERSARIAL_SYSTEM = (
    "You are a code review expert performing an adversarial audit. "
    "Your job is NOT to improve this migration. Your ONLY job is to find behaviour "
    "differences between the original code and the migrated code. Be skeptical. "
    "Assume the migration is wrong until you have specifically checked and ruled out "
    "each category of error below. If you find no differences, you must explain "
    "specifically what you checked and why you are confident, not simply state "
    "'no issues found'."
)


def _build_user_prompt(inp: AIReviewInput) -> str:
    rule_title = getattr(inp.business_rule, "title", "")
    rule_desc = getattr(inp.business_rule, "description", str(inp.business_rule))
    rule_spec = f"{rule_title}: {rule_desc}" if rule_title else rule_desc

    return f"""\
=== ORIGINAL {inp.source_language.upper()} SOURCE CODE ===
{inp.chunk.source}

=== MIGRATED PYTHON CODE ===
{inp.migrated_code}

=== BUSINESS RULE SPECIFICATION ===
The migrated code should implement exactly this rule, nothing more, nothing less:
{rule_spec}

=== CATEGORIES TO CHECK ===

ARITHMETIC: Integer vs float division differences. COBOL truncates on integer \
division, Python / returns float. Check every division operation.

DATE_TIME: Date format differences. COBOL often stores dates as YYYYMMDD integers. \
Check date parsing, comparison, and arithmetic for off-by-one or format errors.

STRING_HANDLING: COBOL pads strings to fixed length with spaces. Python strings are \
variable length. Check for comparison bugs from untrimmed padding, and truncation \
differences.

NULL_HANDLING: COBOL has no concept of null the way Python does. Check how \
empty/zero/space values are handled and whether the migration introduces None where \
COBOL would have used a default value, or vice versa.

ROUNDING: Financial calculations must use exact decimal arithmetic. Check every \
rounding operation matches COBOL's ROUNDED clause behaviour (round half up) versus \
Python's default (round half to even).

LOOP_BOUNDARY: COBOL PERFORM UNTIL checks the condition AFTER the first iteration \
(post-test). Python while checks BEFORE (pre-test). Check every loop boundary for \
off-by-one differences.

EXCEPTION_HANDLING: COBOL has no exceptions in the Python sense. Check that error \
conditions the original code handled (file not found, invalid data, division by zero) \
are still handled correctly in the migration, not silently swallowed or differently raised.

=== OUTPUT FORMAT ===
Respond in valid JSON only, no markdown, no commentary outside the JSON, \
matching this exact schema:
{{
  "issues": [
    {{
      "category": "arithmetic|date_time|string_handling|null_handling|rounding|loop_boundary|exception_handling|other",
      "severity": "critical|moderate|minor",
      "description": "plain English explanation of the difference found",
      "original_behaviour": "what the old code does in this scenario",
      "migrated_behaviour": "what the new code does differently",
      "suggested_fix": "concrete fix or null"
    }}
  ],
  "checked_categories": ["list", "of", "category", "names", "actually", "examined"],
  "confidence": "High|Medium|Low",
  "summary": "one paragraph overall assessment"
}}
If no issues are found, issues should be an empty list, but checked_categories \
and summary must still be filled in explaining what was verified."""


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------

def _try_parse_json(raw: str) -> dict | None:
    """Strip markdown fences and attempt JSON parse. Returns None on any failure."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        inner = lines[1:]
        if inner and inner[-1].strip() == "```":
            inner = inner[:-1]
        text = "\n".join(inner).strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


def _build_result_from_parsed(data: dict, elapsed: float) -> AIReviewResult:
    issues: list[AIReviewIssue] = []
    for item in data.get("issues", []):
        if not isinstance(item, dict):
            continue
        issues.append(AIReviewIssue(
            category=str(item.get("category", "other")).lower(),
            severity=str(item.get("severity", "minor")).lower(),
            description=str(item.get("description", "")),
            original_behaviour=str(item.get("original_behaviour", "")),
            migrated_behaviour=str(item.get("migrated_behaviour", "")),
            suggested_fix=item.get("suggested_fix") or None,
        ))

    return AIReviewResult(
        issues_found=len(issues),
        issues=issues,
        reviewer_confidence=str(data.get("confidence", "Medium")),
        reviewer_summary=str(data.get("summary", "")),
        checked_categories=list(data.get("checked_categories", [])),
        review_time_seconds=elapsed,
        retry_recommended=any(i.severity == "critical" for i in issues),
    )


def _parse_error_result(elapsed: float) -> AIReviewResult:
    return AIReviewResult(
        issues_found=1,
        issues=[AIReviewIssue(
            category="other",
            severity="moderate",
            description="AI review could not parse a valid response after retry",
            original_behaviour="Unknown",
            migrated_behaviour="Unknown",
            suggested_fix="Manual review recommended",
        )],
        reviewer_confidence="Low",
        reviewer_summary=(
            "Automated review could not produce a parseable JSON response after two "
            "attempts. Manual review strongly recommended before approval."
        ),
        checked_categories=[],
        review_time_seconds=elapsed,
        retry_recommended=False,
    )


def _exception_result(exc: Exception, elapsed: float) -> AIReviewResult:
    return AIReviewResult(
        issues_found=0,
        issues=[AIReviewIssue(
            category="other",
            severity="moderate",
            description=f"AI review encountered an error and could not complete: {exc}",
            original_behaviour="Unknown",
            migrated_behaviour="Unknown",
            suggested_fix="Manual review recommended",
        )],
        reviewer_confidence="Low",
        reviewer_summary=(
            f"Automated review failed: {exc}. "
            "Manual review strongly recommended before approval."
        ),
        checked_categories=[],
        review_time_seconds=elapsed,
        retry_recommended=True,
    )


def _demo_result(inp: AIReviewInput, elapsed: float) -> AIReviewResult:
    """Return a deterministic no-network review for demo and smoke-test runs."""
    static_passed = bool(getattr(inp.static_analysis, "passed", False))
    checked = [
        "arithmetic",
        "rounding",
        "string_handling",
        "null_handling",
        "exception_handling",
    ]
    if static_passed:
        return AIReviewResult(
            issues_found=0,
            issues=[],
            reviewer_confidence="Medium",
            reviewer_summary=(
                "Demo review completed locally. Static analysis passed and the "
                "generated code uses Decimal arithmetic for the confirmed rule."
            ),
            checked_categories=checked,
            review_time_seconds=elapsed,
            retry_recommended=False,
        )

    issues = [
        AIReviewIssue(
            category="other",
            severity="moderate",
            description="Static analysis reported issues before semantic review.",
            original_behaviour="Legacy behaviour requires manual comparison.",
            migrated_behaviour="Migrated code did not pass deterministic checks.",
            suggested_fix="Fix static-analysis issues before approval.",
        )
    ]
    return AIReviewResult(
        issues_found=len(issues),
        issues=issues,
        reviewer_confidence="Low",
        reviewer_summary="Demo review found static-analysis issues.",
        checked_categories=checked,
        review_time_seconds=elapsed,
        retry_recommended=False,
    )


# ---------------------------------------------------------------------------
# Public API — module-level adversarial review function
# ---------------------------------------------------------------------------

async def review(inp: AIReviewInput) -> AIReviewResult:
    """
    Run an adversarial LLM review comparing original source to migrated Python.

    Never raises.  Returns an AIReviewResult with reviewer_confidence="Low"
    and a descriptive issue if the review cannot be completed for any reason.

    Retry logic:
      - JSON parse failure: one retry with a clarifying instruction appended.
      - Any unexpected exception: caught by outer try/except, returns error result.
    """
    t_start = time.monotonic()
    if DEMO_MODE:
        result = _demo_result(inp, time.monotonic() - t_start)
        status = (
            f"[red]{result.issues_found} issues[/red]"
            if result.issues_found
            else "[green]no issues[/green]"
        )
        console.print(
            f"  Layer 2 AI review: {status} | "
            f"confidence={result.reviewer_confidence} | "
            f"retry={result.retry_recommended}"
        )
        return result

    try:
        client = LLMClient()
        system = _ADVERSARIAL_SYSTEM
        user = _build_user_prompt(inp)

        raw = await client.complete(
            system=system,
            user=user,
            temperature=0.1,
            max_tokens=4096,
        )

        parsed = _try_parse_json(raw)

        if parsed is None:
            logger.warning(
                "Layer 2: JSON parse failed on first attempt for chunk '%s', retrying",
                inp.chunk.name,
            )
            logger.debug("Layer 2 raw response (first 500 chars): %s", raw[:500])
            retry_user = (
                user
                + "\n\nYour previous response was not valid JSON. "
                  "Respond with ONLY the JSON object, nothing else."
            )
            raw = await client.complete(
                system=system,
                user=retry_user,
                    temperature=0.1,
                max_tokens=4096,
            )
            parsed = _try_parse_json(raw)

        if parsed is None:
            logger.error(
                "Layer 2: JSON parse failed on both attempts for chunk '%s'",
                inp.chunk.name,
            )
            return _parse_error_result(time.monotonic() - t_start)

        result = _build_result_from_parsed(parsed, time.monotonic() - t_start)

        if DEMO_MODE:
            status = (
                f"[red]{result.issues_found} issues[/red]"
                if result.issues_found
                else "[green]no issues[/green]"
            )
            console.print(
                f"  Layer 2 AI review: {status} | "
                f"confidence={result.reviewer_confidence} | "
                f"retry={result.retry_recommended}"
            )

        return result

    except Exception as exc:
        logger.error("AI review failed: %s", exc, exc_info=True)
        return _exception_result(exc, time.monotonic() - t_start)


# ---------------------------------------------------------------------------
# Legacy AIReviewer class — backward compatibility with MigrationPipeline
# ---------------------------------------------------------------------------

_LEGACY_SYSTEM = """\
You are an expert code migration reviewer specialising in legacy COBOL/Java/VB6
to Python migrations.

Your job is to compare the original legacy code with the migrated Python code
and identify any SEMANTIC differences — cases where the Python code would
produce a different result than the original.

You are also given a list of known migration gotchas to watch for.

Return your findings as a JSON object with this exact structure:
{
  "critical_issues": [
    "Description of an issue that MUST be fixed (would cause wrong results)"
  ],
  "warnings": [
    "Description of something suspicious that should be reviewed"
  ],
  "suggestions": [
    "Optional improvement that doesn't affect correctness"
  ],
  "confidence": "High | Medium | Low"
}

Return ONLY valid JSON. No markdown, no explanation outside the JSON.
"""

_LEGACY_REVIEW_TEMPLATE = """\
Review this migration for semantic correctness.

=== ORIGINAL LEGACY CODE ===
{source_code}

=== MIGRATED PYTHON CODE ===
{migrated_code}

=== KNOWN MIGRATION GOTCHAS TO CHECK ===
{gotchas}

=== APPLICABLE BUSINESS RULES ===
{business_rules}

Identify any semantic differences, missing edge cases, or gotcha violations.
"""


class AIReviewer:
    """
    Async class-based interface used by MigrationPipeline.run_layer2().

    Takes a MigrationChunk (no business rule / language context) and returns the
    Pydantic AIReviewResult from models.chunk that the full pipeline expects.

    For the richer per-chunk review with full context, use the module-level
    review() function with AIReviewInput.
    """

    def __init__(self) -> None:
        self._client = LLMClient()
        self.gotchas: list[str] = []
        self.business_rule_descriptions: list[str] = []

    async def review(self, chunk: MigrationChunk) -> _LegacyAIReviewResult:
        if DEMO_MODE:
            console.print(
                f"[dim]AIReviewer.review() → reviewing chunk [{chunk.name}][/dim]"
            )
            # Demo mode never makes a real Venice call, even if a (possibly
            # misconfigured) key happens to be present in the environment.
            return self._stub_result(chunk.name)

        try:
            user_prompt = _LEGACY_REVIEW_TEMPLATE.format(
                source_code=chunk.source_code[:3000],
                migrated_code=chunk.migrated_code[:3000],
                gotchas="\n".join(f"- {g}" for g in self.gotchas) or "None listed.",
                business_rules=(
                    "\n".join(f"- {r}" for r in self.business_rule_descriptions)
                    or "None identified for this chunk."
                ),
            )

            raw = await self._client.complete(
                system=_LEGACY_SYSTEM,
                user=user_prompt,
                temperature=0.1,
            )

            return self._parse_response(raw)

        except Exception as exc:
            if DEMO_MODE:
                console.print(f"[red]AIReviewer error: {exc}[/red]")
            return self._stub_result(chunk.name)

    def _parse_response(self, raw: str) -> _LegacyAIReviewResult:
        text = raw.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])

        try:
            data = json.loads(text)
            critical = data.get("critical_issues", [])
            warnings = data.get("warnings", [])
            suggestions = data.get("suggestions", [])
            confidence = data.get("confidence", "Medium")

            return _LegacyAIReviewResult(
                issues_found=len(critical) + len(warnings),
                critical_issues=critical,
                warnings=warnings,
                suggestions=suggestions,
                ai_confidence=confidence,
                raw_response=raw[:2000],
            )
        except (json.JSONDecodeError, KeyError):
            return self._stub_result("unknown")

    def _stub_result(self, chunk_name: str) -> _LegacyAIReviewResult:
        return _LegacyAIReviewResult(
            issues_found=1,
            critical_issues=[],
            warnings=[],
            suggestions=[
                f"[DEMO] Implement AIReviewer.review() for real semantic checking "
                f"of chunk '{chunk_name}'"
            ],
            ai_confidence="Low",
            raw_response="[DEMO stub response — no LLM call made]",
        )
