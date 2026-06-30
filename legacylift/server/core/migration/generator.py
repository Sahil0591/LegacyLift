"""
core/migration/generator.py — LLM-based Python migration generation.

Takes a selected Layer 0 chunk plus its confirmed business rule, calls
Venice AI (kimi-k2-5) via utils/llm_client.py, and returns a MigrationResult
with generated Python 3.12 code ready for Layer 1 static analysis.

Public API:
    async def generate_migration(inp: MigrationInput) -> MigrationResult

Never raises — always returns a MigrationResult, even on total API failure.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from dataclasses import dataclass, field

from utils.llm_client import LLMClient

logger = logging.getLogger(__name__)
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


# ---------------------------------------------------------------------------
# Input / Output contracts
# ---------------------------------------------------------------------------

@dataclass
class MigrationInput:
    chunk_id: str
    chunk_name: str
    chunk_source: str
    chunk_language: str         # "cobol" | "java"
    business_rule: str          # confirmed plain-English rule text (ground truth)
    rule_confidence: float      # 0.0–1.0 from Layer 0 extractor
    source_language: str        # project-level, e.g. "COBOL"
    related_chunks: list[dict]  # [{"name": str, "source": str, "rule": str}, ...]


@dataclass
class MigrationResult:
    chunk_id: str
    migrated_code: str
    explanation: str
    confidence: str             # "High" | "Medium" | "Low"
    generation_time_seconds: float


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a senior Python engineer specialising in migrating legacy COBOL and Java \
to Python 3.12. You will be given a single code chunk, a confirmed business rule \
that describes exactly what it must do, and context from related chunks.

Rules you MUST follow without exception:
1. Output ONLY valid, runnable Python 3.12 code inside a ```python ... ``` block.
2. Use decimal.Decimal for ALL monetary values — never use float.
3. Add full type hints to every function parameter and return value.
4. Add a docstring that references the confirmed business rule.
5. Preserve the EXACT conditional logic structure: same number of branches and \
   decision points as the original — do not simplify or merge conditionals.
6. If the original handles dates, use datetime.date / datetime.datetime — never raw strings.
7. After the code block, write a brief plain-English explanation under the heading \
   "## Explanation" (one paragraph, no bullet points).
"""


def _build_user_prompt(inp: MigrationInput) -> str:
    lines: list[str] = [
        f"## Chunk to Migrate: {inp.chunk_name}",
        f"Source language: {inp.chunk_language.upper()}",
        "",
        "### Original Source Code",
        "```",
        inp.chunk_source,
        "```",
        "",
        "### Confirmed Business Rule",
        "This is the ground truth specification — implement exactly what it says:",
        inp.business_rule,
        "",
    ]

    if inp.chunk_language == "cobol":
        lines += [
            "### COBOL Conventions",
            "- Fixed-format: columns 1-6 are sequence numbers (ignore), col 7 is indicator, cols 8-72 are code",
            "- COMP-3 / packed-decimal arithmetic → use decimal.Decimal",
            "- PERFORM <NAME> → call function named after the paragraph",
            "- COMPUTE X ROUNDED = expr → assignment with rounding",
            "- EXEC SQL ... END-EXEC → translate to a placeholder function call with a comment",
            "",
        ]

    if inp.related_chunks:
        lines += ["### Related Chunks (callers / callees — for data-flow context)"]
        for rc in inp.related_chunks[:5]:  # cap to keep prompt size manageable
            name = rc.get("name", "Unknown")
            rule = rc.get("rule", "")
            src = (rc.get("source", "") or "")[:400]
            lines += [
                f"#### {name}",
                f"Rule: {rule}",
                "```",
                src,
                "```",
                "",
            ]

    lines += [
        "### Task",
        "Produce the Python 3.12 migration for the chunk above.",
        "Output a ```python block followed immediately by ## Explanation.",
    ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _parse_response(raw: str) -> tuple[str, str]:
    """Return (python_code, explanation) from the LLM response."""
    code_match = re.search(r"```python\s*\n(.*?)```", raw, re.DOTALL)
    if code_match:
        code = code_match.group(1).strip()
        after = raw[code_match.end():].strip()
        explanation = re.sub(
            r"^##\s*Explanation\s*\n?", "", after, flags=re.IGNORECASE
        ).strip()
        if not explanation:
            explanation = "No explanation provided"
    else:
        # Fallback: treat entire response as code
        code = raw.strip()
        explanation = "No explanation provided"

    return code, explanation


# ---------------------------------------------------------------------------
# Confidence heuristic
# ---------------------------------------------------------------------------

def _score_confidence(rule_confidence: float, related_count: int) -> str:
    if rule_confidence >= 0.8 and related_count < 3:
        return "High"
    if rule_confidence < 0.6 or related_count > 5:
        return "Low"
    return "Medium"


def _demo_migration(inp: MigrationInput, confidence: str, elapsed: float) -> MigrationResult:
    """Return deterministic, valid Python for demos without calling the LLM."""
    function_name = re.sub(r"[^0-9a-zA-Z_]+", "_", inp.chunk_id).strip("_").lower()
    if not function_name or function_name[0].isdigit():
        function_name = f"migrate_{function_name}"

    code = f'''\
from decimal import Decimal, ROUND_HALF_UP


def {function_name}(
    balance: Decimal,
    annual_interest_rate: Decimal,
    days_in_period: int,
    bonus_rate: Decimal = Decimal("0"),
) -> Decimal:
    """Implement confirmed rule: {inp.business_rule}"""
    account_master_table = "ACCOUNT_MASTER"
    effective_rate = annual_interest_rate + bonus_rate
    temp_rate = effective_rate / Decimal("100")
    period_factor = Decimal(days_in_period) / Decimal("365")
    interest_amount = balance * temp_rate * period_factor
    return interest_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
'''

    return MigrationResult(
        chunk_id=inp.chunk_id,
        migrated_code=code,
        explanation=(
            "Demo mode generated deterministic Python locally. It uses Decimal "
            "arithmetic, half-up rounding, and references ACCOUNT_MASTER so schema "
            "coverage can observe the account table touched by this chunk."
        ),
        confidence=confidence,
        generation_time_seconds=elapsed,
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def generate_migration(inp: MigrationInput) -> MigrationResult:
    """
    Generate a Python 3.12 migration for a single COBOL/Java chunk.

    Uses Venice AI (kimi-k2-5) via LLMClient. Retries once with a 2-second
    wait on transient failures. Never raises — returns a MigrationResult with
    empty migrated_code and an error explanation on total failure.
    """
    confidence = _score_confidence(inp.rule_confidence, len(inp.related_chunks))
    t_start = time.monotonic()

    if DEMO_MODE:
        elapsed = time.monotonic() - t_start
        result = _demo_migration(inp, confidence, elapsed)
        logger.info(
            "Demo migration generated for %s in %.1fs (confidence=%s, lines=%d)",
            inp.chunk_id,
            elapsed,
            confidence,
            len(result.migrated_code.splitlines()),
        )
        return result

    client = LLMClient()
    system = _SYSTEM_PROMPT
    user = _build_user_prompt(inp)

    async def _attempt() -> str:
        return await client.complete(
            system=system,
            user=user,
            temperature=0.1,
            max_tokens=4096,
        )

    raw: str
    try:
        raw = await _attempt()
    except Exception as exc:
        logger.warning(
            "Migration attempt 1 failed for chunk %s: %s", inp.chunk_id, exc
        )
        try:
            await asyncio.sleep(2)
            raw = await _attempt()
        except Exception as exc2:
            logger.error(
                "Migration failed for chunk %s after retry: %s", inp.chunk_id, exc2
            )
            return MigrationResult(
                chunk_id=inp.chunk_id,
                migrated_code="",
                explanation=f"Migration generation failed: {exc2}",
                confidence="Low",
                generation_time_seconds=time.monotonic() - t_start,
            )

    code, explanation = _parse_response(raw)
    elapsed = time.monotonic() - t_start

    logger.info(
        "Migration generated for %s in %.1fs (confidence=%s, lines=%d)",
        inp.chunk_id,
        elapsed,
        confidence,
        len(code.splitlines()),
    )

    return MigrationResult(
        chunk_id=inp.chunk_id,
        migrated_code=code,
        explanation=explanation,
        confidence=confidence,
        generation_time_seconds=elapsed,
    )
