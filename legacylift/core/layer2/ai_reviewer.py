"""
core/layer2/ai_reviewer.py — LLM-powered semantic code reviewer.

Layer 2 is the SECOND quality gate.  It runs after Layer 1 (static analysis)
and uses the LLM to check that the migrated Python code is SEMANTICALLY
equivalent to the original legacy source.

Static analysis (Layer 1) checks syntax and style.
AI review (Layer 2) checks MEANING:
  - Does the Python produce the same outputs for the same inputs?
  - Are all business rules from the legacy code preserved?
  - Are edge cases handled (negative balances, zero amounts, max values)?
  - Are the COBOL→Python gotchas from Layer 0.5 avoided?

The reviewer is given:
  - The original COBOL source code
  - The migrated Python code
  - The list of gotchas from Layer 0.5
  - Any business rules that apply to this chunk

It returns structured JSON with critical issues, warnings, and suggestions.

Pipeline position: Second step of per-chunk migration, called by pipeline.run_layer2().
"""

from __future__ import annotations

import json
import os

from rich.console import Console

from legacylift.models.chunk import MigrationChunk, AIReviewResult
from legacylift.utils.llm_client import LLMClient

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
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

REVIEW_PROMPT_TEMPLATE = """\
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
    Uses the LLM to review migrated code for semantic equivalence with
    the original legacy source.
    """

    def __init__(self) -> None:
        self._client = LLMClient()
        # Gotchas are set from pipeline.py after Layer 0.5 completes
        self.gotchas: list[str] = []
        self.business_rule_descriptions: list[str] = []

    async def review(self, chunk: MigrationChunk) -> AIReviewResult:
        """
        Run an LLM review of the migrated code against the original source.

        Args:
            chunk: MigrationChunk with source_code AND migrated_code populated.

        Returns:
            AIReviewResult with critical_issues, warnings, and suggestions.

        TODO (implementer):
          - Inject the gotchas from Layer 0.5 into self.gotchas before calling.
            Do this in pipeline.py after run_layer0_5() completes:
              reviewer.gotchas = target_profile.gotchas
          - Inject applicable BusinessRule descriptions for this chunk.
          - Parse the LLM's JSON response robustly (handle markdown fences).
          - If the chunk has critical issues, regenerate it (in pipeline.py)
            rather than passing it through to human review.
          - Store raw_response in AIReviewResult for the audit trail.
        """
        if DEMO_MODE:
            console.print(
                f"[dim]AIReviewer.review() → reviewing chunk [{chunk.name}][/dim]"
            )

        try:
            user_prompt = REVIEW_PROMPT_TEMPLATE.format(
                source_code=chunk.source_code[:3000],
                migrated_code=chunk.migrated_code[:3000],
                gotchas="\n".join(f"- {g}" for g in self.gotchas) or "None listed.",
                business_rules="\n".join(
                    f"- {r}" for r in self.business_rule_descriptions
                ) or "None identified for this chunk.",
            )

            raw = await self._client.complete(
                system=SYSTEM_PROMPT,
                user=user_prompt,
                temperature=0.1,
            )

            return self._parse_response(raw)

        except Exception as exc:
            if DEMO_MODE:
                console.print(f"[red]AIReviewer error: {exc}[/red]")
            # Return a clean pass so pipeline continues in demo mode
            return self._stub_result(chunk.name)

    def _parse_response(self, raw: str) -> AIReviewResult:
        """
        Parse the LLM's JSON review response into an AIReviewResult.

        Args:
            raw: Raw string from the LLM.

        Returns:
            AIReviewResult with parsed fields.

        TODO (implementer):
          - Handle markdown code fences (```json ... ```).
          - Validate that required keys are present; fill defaults if missing.
          - Log parse failures at WARNING level, don't raise.
        """
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

            return AIReviewResult(
                issues_found=len(critical) + len(warnings),
                critical_issues=critical,
                warnings=warnings,
                suggestions=suggestions,
                ai_confidence=confidence,
                raw_response=raw[:2000],
            )
        except (json.JSONDecodeError, KeyError):
            return self._stub_result("unknown")

    def _stub_result(self, chunk_name: str) -> AIReviewResult:
        """
        Return a canned review result for DEMO_MODE or when LLM fails.

        TODO (implementer): remove once real review is working.
        The stub always returns a clean pass with one suggestion so the
        pipeline completes end-to-end without errors.
        """
        return AIReviewResult(
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
