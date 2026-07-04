"""
core/migration/generator.py - LLM-based target-language migration generation.

Takes a selected Layer 0 chunk plus its confirmed business rule, calls the LLM
via utils/llm_client.py, and returns a MigrationResult with generated target
code ready for Layer 1 static analysis.

Public API:
    async def generate_migration(inp: MigrationInput) -> MigrationResult

Never raises — always returns a MigrationResult, even on total API failure.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field

from core.target_languages import demo_migration_code, target_profile_payload
from utils.llm_client import LLMClient
from utils.migration_prompts import build_migration_prompt, strip_code_fence

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
    target_language: str        # project/file-level target, e.g. "Python" | "Java"
    related_chunks: list[dict]  # [{"name": str, "source": str, "rule": str}, ...]
    target_profile: dict | None = None
    file_context: str = ""      # full content of the file this chunk belongs to
    project_manifest: str = ""  # lightweight cross-file manifest (deps + rules)
    lessons_learned: str = ""   # past rejection reasons / AI review findings for this project


@dataclass
class MigrationResult:
    chunk_id: str
    migrated_code: str
    explanation: str
    confidence: str             # "High" | "Medium" | "Low"
    generation_time_seconds: float


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _parse_response(raw: str) -> tuple[str, str]:
    """Return (target_code, explanation) from an LLM response."""

    if "## Explanation" in raw:
        code_part, explanation_part = raw.split("## Explanation", 1)
        code = strip_code_fence(code_part)
        explanation = explanation_part.strip() or "No explanation provided"
        return code, explanation

    return strip_code_fence(raw), "No explanation provided"


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
    """Return deterministic target-language code for demos without the LLM."""
    code = demo_migration_code(
        inp.target_language,
        chunk_id=inp.chunk_id,
        business_rule=inp.business_rule,
    )

    return MigrationResult(
        chunk_id=inp.chunk_id,
        migrated_code=code,
        explanation=(
            f"Demo mode generated deterministic {inp.target_language} locally. "
            "This is a syntax/static-validation fixture, not production output."
        ),
        confidence=confidence,
        generation_time_seconds=elapsed,
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def generate_migration(inp: MigrationInput) -> MigrationResult:
    """
    Generate a target-language migration for a single legacy chunk.

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
    profile = inp.target_profile or target_profile_payload(inp.target_language)
    source_lang = inp.source_language or inp.chunk_language.upper()
    system, user = build_migration_prompt(
        name=inp.chunk_name,
        source_code=inp.chunk_source,
        source_lang=source_lang,
        target_lang=inp.target_language,
        business_rules=[
            {
                "title": inp.chunk_name,
                "description": inp.business_rule,
                "hardcoded_values": [],
            }
        ],
        target_profile=profile,
        file_context=inp.file_context,
        project_manifest=inp.project_manifest,
        lessons_learned=inp.lessons_learned,
    )

    async def _attempt() -> str:
        return await client.complete(
            system=system,
            user=user,
            temperature=0.1,
            max_tokens=8000,
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
