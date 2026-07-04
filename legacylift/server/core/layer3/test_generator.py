"""
core/layer3/test_generator.py - LLM-powered test case generator.

Layer 3 reads the original legacy source alongside the migrated code, asks the
LLM to produce structured target-framework tests, and returns those tests for
manual verification. Test execution is intentionally disabled until a locked
down sandbox runner exists.

Pipeline position: called by run_migration_generation() in pipeline.py after
Layer 2 AI review completes.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

from models.business_rule import BusinessRule
from utils.code_parser import CodeChunk
from core.layer2.ai_reviewer import AIReviewResult
from utils.llm_client import LLMClient
from utils.migration_prompts import build_test_prompt

logger = logging.getLogger(__name__)

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


# ---------------------------------------------------------------------------
# Data contracts
# ---------------------------------------------------------------------------

@dataclass
class TestGenerationInput:
    chunk: CodeChunk
    migrated_code: str
    business_rule: BusinessRule
    ai_review: AIReviewResult
    target_language: str = "Python"
    target_profile: dict | None = None


@dataclass
class GeneratedTest:
    name: str
    category: str        # "normal" | "boundary" | "edge_case" | "gotcha_specific"
    description: str
    inputs: dict
    expected_output: dict
    reasoning: str


@dataclass
class TestResult:
    test_name: str
    passed: bool
    expected: dict
    actual: Optional[dict]
    error: Optional[str] = None


@dataclass
class TestGenerationResult:
    tests_generated: list[GeneratedTest]
    test_results: list[TestResult]
    total: int
    passed: int
    failed: int
    all_passed: bool
    retry_recommended: bool
    summary: str
    generation_time_seconds: float
    execution_time_seconds: float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _strip_fences(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    inner: list[str] = []
    started = False
    for line in lines:
        if not started:
            if line.startswith("```"):
                started = True
            continue
        if line.strip() == "```":
            break
        inner.append(line)
    return "\n".join(inner)


def _build_prompts(inp: TestGenerationInput) -> tuple[str, str]:
    """Return (system_prompt, user_prompt) for the test-generation LLM call."""
    if inp.ai_review.issues:
        issues_text = "\n".join(
            f"- [{i.category}/{i.severity}] {i.description}"
            for i in inp.ai_review.issues
        )
    else:
        issues_text = "None found."

    hardcoded = getattr(inp.business_rule, "hardcoded_values", []) or []
    hints = (
        f"Hardcoded values extracted from rule: {', '.join(hardcoded)}"
        if hardcoded else
        "See COBOL source for exact numeric thresholds."
    )

    if inp.target_language.strip().casefold() != "python":
        system, user = build_test_prompt(
            name=inp.chunk.name,
            migrated_code=inp.migrated_code[:3000],
            target_lang=inp.target_language,
            target_profile=inp.target_profile,
        )
        user += (
            "\n\nExecution is disabled in this environment. Generate the test "
            "file for reviewer inspection only; do not assume it will be run."
        )
        return system, user

    system = (
        "You are an expert Python test engineer specialising in verifying COBOL-to-Python "
        "migrations.  Your task is to write structured test cases that prove the migrated "
        "Python code produces exactly the same outputs as the original COBOL for the same "
        "inputs.  All numeric thresholds MUST be derived from the COBOL source provided — "
        "never invent values.  Respond ONLY with valid JSON — no markdown fences, no "
        "commentary."
    )

    user = f"""Generate pytest test cases for this COBOL-to-Python migration.

=== ORIGINAL COBOL SOURCE (extract exact thresholds and branch conditions from here) ===
{inp.chunk.source[:3000]}

=== BUSINESS RULE (supporting context — use COBOL source for exact values) ===
{inp.business_rule.description}
{hints}

=== MIGRATED PYTHON CODE (this is what you are testing — use its function signature) ===
{inp.migrated_code[:3000]}

=== LAYER 2 AI REVIEW ISSUES (areas to stress-test) ===
{issues_text}

Generate pytest test cases for this migration.  You must:
- Read the actual numeric thresholds and conditions from the COBOL source code provided, do not invent values
- Generate at least one test per distinct condition branch found in the source (category: "normal")
- Generate boundary tests at the exact threshold values found in the source, e.g. if the source has "IF WS-BALANCE > 100000" generate a test at exactly 100000 and one at 100001 (category: "boundary")
- Generate edge case tests: zero values, negative values where applicable, maximum reasonable values (category: "edge_case")
- If the migrated code handles money, generate a test specifically checking decimal precision is preserved, not float rounding errors (category: "gotcha_specific")
- If the migrated code handles dates, generate a leap year test and a year-end boundary test if relevant (category: "gotcha_specific")
- If Layer 2 review issues mention specific categories like rounding, date handling, or boundary conditions, generate additional targeted tests for those specific categories
- For each test provide the exact input values as a dict matching the migrated function's parameter names
- For expected_output values, calculate them by hand based on the business rule logic — do not guess
- Provide brief reasoning for each expected value referencing the source code or rule

Respond in valid JSON only, no markdown, no commentary, matching this schema exactly:
{{
  "tests": [
    {{
      "name": "<valid Python snake_case identifier starting with test_>",
      "category": "normal" | "boundary" | "edge_case" | "gotcha_specific",
      "description": "<plain English description>",
      "inputs": {{"<param_name>": <value>, ...}},
      "expected_output": {{"<field_name>": <value>, ...}},
      "reasoning": "<why this expected value is correct>"
    }}
  ]
}}"""

    return system, user


def _parse_generated_tests(raw: str) -> list[GeneratedTest]:
    data = json.loads(_strip_fences(raw))
    return [
        GeneratedTest(
            name=t["name"],
            category=t.get("category", "normal"),
            description=t.get("description") or t.get("purpose", ""),
            inputs=t.get("inputs", {}),
            expected_output=t.get("expected_output", {}),
            reasoning=t.get("reasoning") or t.get("purpose", ""),
        )
        for t in data.get("tests", [])
        if isinstance(t, dict) and isinstance(t.get("name"), str)
    ]


# ---------------------------------------------------------------------------
# Demo stub
# ---------------------------------------------------------------------------

def _demo_result(target_language: str = "Python") -> TestGenerationResult:
    stubs = [
        GeneratedTest(
            name="test_normal_case",
            category="normal",
            description="[DEMO] Happy-path test — not real execution",
            inputs={"balance": 50000},
            expected_output={"interest": "125.00"},
            reasoning="[DEMO] stub",
        ),
        GeneratedTest(
            name="test_boundary_at_threshold",
            category="boundary",
            description="[DEMO] Balance exactly at tier boundary",
            inputs={"balance": 100000},
            expected_output={"interest": "250.00"},
            reasoning="[DEMO] stub",
        ),
        GeneratedTest(
            name="test_decimal_precision",
            category="gotcha_specific",
            description="[DEMO] Decimal precision check",
            inputs={"balance": 33333},
            expected_output={"interest": "83.33"},
            reasoning="[DEMO] stub",
        ),
    ]
    stub_results = [
        TestResult(
            test_name=t.name,
            passed=False,
            expected=t.expected_output,
            actual=None,
            error="Execution disabled - manual verification required",
        )
        for t in stubs
    ]
    return TestGenerationResult(
        tests_generated=stubs,
        test_results=stub_results,
        total=3, passed=0, failed=0,
        all_passed=False, retry_recommended=False,
        summary=(
            f"3 {target_language} test(s) generated - execution disabled; "
            "manual verification required"
        ),
        generation_time_seconds=0.0,
        execution_time_seconds=0.0,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_and_run_tests(inp: TestGenerationInput) -> TestGenerationResult:
    """
    Generate test cases via LLM and return them for manual verification.

    Never raises — always returns a TestGenerationResult.
    """
    if DEMO_MODE:
        return _demo_result(inp.target_language)

    try:
        client = LLMClient()

        # ── Phase 1: Generation ────────────────────────────────────────────
        gen_start = time.monotonic()
        tests_generated: list[GeneratedTest] = []

        try:
            system_prompt, user_prompt = _build_prompts(inp)

            raw = await client.complete(
                system=system_prompt,
                user=user_prompt,
                temperature=0.1,
            )

            try:
                tests_generated = _parse_generated_tests(raw)
            except (json.JSONDecodeError, KeyError, ValueError) as parse_err:
                logger.warning("Layer 3: initial parse failed (%s), retrying", parse_err)
                retry_prompt = (
                    user_prompt
                    + f"\n\nYour previous response could not be parsed as JSON: {parse_err}\n"
                    "Fix it and return ONLY valid JSON matching the schema. No markdown."
                )
                raw2 = await client.complete(
                    system=system_prompt,
                    user=retry_prompt,
                    temperature=0.0,
                )
                try:
                    tests_generated = _parse_generated_tests(raw2)
                except Exception as retry_err:
                    logger.error("Layer 3: retry parse also failed: %s", retry_err)
                    return TestGenerationResult(
                        tests_generated=[], test_results=[],
                        total=0, passed=0, failed=0,
                        all_passed=False, retry_recommended=True,
                        summary="Test generation failed, manual verification required",
                        generation_time_seconds=time.monotonic() - gen_start,
                        execution_time_seconds=0.0,
                    )

        except Exception as gen_exc:
            logger.error("Layer 3: generation phase error: %s", gen_exc, exc_info=True)
            return TestGenerationResult(
                tests_generated=[], test_results=[],
                total=0, passed=0, failed=0,
                all_passed=False, retry_recommended=True,
                summary=f"Test generation failed: {gen_exc}. Manual verification required.",
                generation_time_seconds=time.monotonic() - gen_start,
                execution_time_seconds=0.0,
            )

        generation_time = time.monotonic() - gen_start

        if not tests_generated:
            return TestGenerationResult(
                tests_generated=[], test_results=[],
                total=0, passed=0, failed=0,
                all_passed=False, retry_recommended=False,
                summary="LLM generated no test cases",
                generation_time_seconds=generation_time,
                execution_time_seconds=0.0,
            )

        # ── Phase 2: Execution (DISABLED — sandbox not available) ─────────
        # AI-generated code must not run in the server process.
        # Tests are returned as "manual verification required" so reviewers
        # can inspect them; execution can be re-enabled once a locked-down
        # sandbox (no network, read-only FS, non-root, ephemeral) is in place.
        #
        # This is NOT a test failure — passed=False/failed=0 here means "not
        # run", not "ran and failed". Downstream consumers must not report
        # these as failing tests; retry_recommended stays False because there
        # is no test-quality signal to react to.
        exec_start = time.monotonic()
        test_results: list[TestResult] = [
            TestResult(
                test_name=t.name, passed=False,
                expected=t.expected_output, actual=None,
                error="Execution disabled — manual verification required",
            )
            for t in tests_generated
        ]

        execution_time = time.monotonic() - exec_start

        # ── Assemble result ────────────────────────────────────────────────
        total = len(test_results)
        summary = (
            f"{total} test(s) generated — execution is disabled in this "
            "environment (no sandbox available). Manual verification required "
            "before approval."
        )

        return TestGenerationResult(
            tests_generated=tests_generated,
            test_results=test_results,
            total=total, passed=0, failed=0,
            all_passed=False,
            retry_recommended=False,
            summary=summary,
            generation_time_seconds=generation_time,
            execution_time_seconds=execution_time,
        )

    except Exception as e:
        logger.error("Test generation failed: %s", e, exc_info=True)
        return TestGenerationResult(
            tests_generated=[], test_results=[],
            total=0, passed=0, failed=0,
            all_passed=False, retry_recommended=True,
            summary=f"Test generation encountered an error: {e}. Manual verification required.",
            generation_time_seconds=0.0,
            execution_time_seconds=0.0,
        )


# ---------------------------------------------------------------------------
# Backward-compatible class for MigrationPipeline.run_layer3()
# ---------------------------------------------------------------------------

# Import pydantic TestResult under an alias to avoid shadowing the dataclass above.
from models.chunk import TestResult as _PydanticTestResult  # noqa: E402


class TestGenerator:
    """
    Class wrapper kept for MigrationPipeline.run_layer3() compatibility.
    Internally delegates to generate_and_run_tests().
    """

    async def generate_and_run(
        self,
        chunk: Any,
        target_language: str = "Python",
        target_profile: dict | None = None,
    ) -> list[_PydanticTestResult]:
        from utils.code_parser import CodeChunk as _CC  # noqa: PLC0415
        from models.business_rule import BusinessRule as _BR  # noqa: PLC0415
        from core.layer2.ai_reviewer import AIReviewResult as _AR  # noqa: PLC0415

        if DEMO_MODE or not (chunk.migrated_code or "").strip():
            return self._stubs(chunk.name, target_language=target_language)

        code_chunk = _CC(
            id=chunk.id,
            name=chunk.name,
            language="cobol",
            source=chunk.source_code,
            start_line=0,
            end_line=0,
        )
        business_rule = _BR(
            title=chunk.name,
            description=f"Business rule for {chunk.name}",
            source_file="unknown",
        )
        ai_review = _AR(
            issues_found=0, issues=[],
            reviewer_confidence="Medium", reviewer_summary="",
            checked_categories=[], review_time_seconds=0.0,
            retry_recommended=False,
        )

        result = await generate_and_run_tests(TestGenerationInput(
            chunk=code_chunk,
            migrated_code=chunk.migrated_code,
            business_rule=business_rule,
            ai_review=ai_review,
            target_language=target_language,
            target_profile=target_profile,
        ))

        pydantic_results = [
            _PydanticTestResult(
                name=r.test_name,
                passed=r.passed,
                error_message=r.error,
                duration_ms=0.0,
            )
            for r in result.test_results
        ]
        return pydantic_results or self._stubs(
            chunk.name,
            target_language=target_language,
        )

    def _stubs(
        self,
        name: str,
        target_language: str = "Python",
    ) -> list[_PydanticTestResult]:
        safe = name.lower().replace("-", "_")
        message = f"{target_language} test generated; execution disabled - manual verification required"
        return [
            _PydanticTestResult(
                name=f"test_{safe}_happy_path",
                passed=False,
                error_message=message,
                duration_ms=0.0,
            ),
            _PydanticTestResult(
                name=f"test_{safe}_boundary",
                passed=False,
                error_message=message,
                duration_ms=0.0,
            ),
            _PydanticTestResult(
                name=f"test_{safe}_edge_case",
                passed=False,
                error_message=message,
                duration_ms=0.0,
            ),
        ]
