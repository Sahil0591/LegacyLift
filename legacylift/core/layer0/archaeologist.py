"""
core/layer0/archaeologist.py — Structural code scanner and chunk builder.

The Archaeologist is the first thing that runs when a project starts.
It performs a language-agnostic structural scan of every uploaded file:
  - Counts lines, identifies dead code regions
  - Detects the overall structure (sections, paragraphs, classes, functions)
  - Determines how to split the file into MigrationChunks for downstream layers
  - Does NOT use the LLM — this is pure static analysis

Output feeds into:
  - business_extractor.py (which sections to analyse for business rules)
  - dependency_mapper.py  (which sections call which)
  - risk_scorer.py        (line counts and complexity as input signals)
  - pipeline.py           (the final chunk list drives Layers 1-3)

Pipeline position: First step of Layer 0, called by pipeline.run_layer0().
"""

from __future__ import annotations

import os
from typing import Any

from rich.console import Console

from legacylift.models.project import Project
from legacylift.models.chunk import MigrationChunk, RiskLevel
from legacylift.utils.code_parser import CodeParser

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


class Archaeologist:
    """
    Scans legacy source files for structural metadata and builds
    the MigrationChunk list used throughout the rest of the pipeline.
    """

    async def analyse(self, project: Project) -> dict[str, Any]:
        """
        Perform a structural scan of all uploaded files.

        Args:
            project: Project with .files populated from uploads.

        Returns:
            A findings dict with structure:
            {
              "files": {
                "<filename>": {
                  "line_count":    int,
                  "sections":      list[str],
                  "dead_regions":  list[(start, end)],
                  "has_comp3":     bool,   # COBOL packed decimal flag
                  "has_global":    bool,   # global state flag
                }
              }
            }

        TODO (implementer):
          - Instantiate CodeParser(language=project.source_language).
          - Call parser.parse(file.content) on each file.
          - For COBOL: detect COMP-3 usage (packed decimal arithmetic that
            behaves differently from Python float).
          - For COBOL: detect FILE SECTION (indicates file I/O that needs
            special handling in Python).
          - Populate file.line_count and file.detected_dependencies.
          - Return a rich findings dict, not just the stub below.
        """
        if DEMO_MODE:
            console.print("[dim]Archaeologist.analyse() → returning stub findings[/dim]")

        findings: dict[str, Any] = {"files": {}}

        for f in project.files:
            # PLACEHOLDER — real implementation uses CodeParser
            f.line_count = len(f.content.splitlines()) if f.content else 0

            findings["files"][f.filename] = {
                "line_count":   f.line_count,
                "sections":     self._stub_sections(f.filename),
                "dead_regions": [(45, 52)],
                "has_comp3":    "COMP-3" in (f.content or ""),
                "has_global":   "GLOBAL" in (f.content or ""),
            }

        return findings

    def build_chunks(
        self,
        project: Project,
        risk_scores: dict[str, float],
    ) -> list[MigrationChunk]:
        """
        Split uploaded files into processable MigrationChunks.

        Called by pipeline.run_layer0() after analyse() and risk scoring.

        Args:
            project:     Project with .files populated.
            risk_scores: Per-filename risk score from RiskScorer (0.0-1.0).

        Returns:
            Ordered list of MigrationChunks, sorted highest-risk first so the
            riskiest code gets human review attention early.

        TODO (implementer):
          - Use CodeParser.split_into_chunks() on each file.
          - Map the per-file risk_score to a RiskLevel enum.
          - Preserve COBOL SECTION/PARAGRAPH ordering within a file.
          - For files >1000 lines, apply a secondary split at blank-line
            boundaries to keep chunks under ~80 lines for LLM context fit.
        """
        if DEMO_MODE:
            console.print("[dim]Archaeologist.build_chunks() → building stub chunks[/dim]")

        parser = CodeParser(language=project.source_language)
        chunks: list[MigrationChunk] = []

        for f in project.files:
            raw_chunks = parser.split_into_chunks(f.content or "-- empty --")
            file_risk = risk_scores.get(f.filename, 0.5)
            risk_level = self._score_to_level(file_risk)

            for chunk_name, chunk_src, start, end in raw_chunks:
                chunk = MigrationChunk(
                    name=f"{f.filename.upper().replace('.', '_')}__{chunk_name}",
                    source_code=chunk_src,
                    # migrated_code will be populated by the LLM generation step
                    migrated_code="# TODO: LLM-generated Python goes here\npass",
                    diff=(
                        f"--- {f.filename} (lines {start}-{end})\n"
                        "+++ migrated.py\n"
                        "# diff will be generated after migration\n"
                    ),
                    risk_level=risk_level,
                )
                chunks.append(chunk)

        # Always return at least one chunk for demo purposes
        if not chunks:
            chunks.append(MigrationChunk(
                name="DEMO-CHUNK",
                source_code="MOVE 10000 TO INTEREST-THRESHOLD.",
                migrated_code="INTEREST_THRESHOLD = Decimal('10000')",
                diff=(
                    "--- demo.cbl\n+++ demo.py\n"
                    "-MOVE 10000 TO INTEREST-THRESHOLD.\n"
                    "+INTEREST_THRESHOLD = Decimal('10000')\n"
                ),
                risk_level=RiskLevel.MEDIUM,
            ))

        # Sort: CRITICAL first, then HIGH, MEDIUM, LOW
        order = {RiskLevel.CRITICAL: 0, RiskLevel.HIGH: 1,
                 RiskLevel.MEDIUM: 2, RiskLevel.LOW: 3}
        chunks.sort(key=lambda c: order.get(c.risk_level, 99))
        return chunks

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    def _score_to_level(self, score: float) -> RiskLevel:
        """Convert a 0.0-1.0 risk score float to a RiskLevel enum value."""
        if score >= 0.8:
            return RiskLevel.CRITICAL
        elif score >= 0.6:
            return RiskLevel.HIGH
        elif score >= 0.3:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW

    def _stub_sections(self, filename: str) -> list[str]:
        """Return canned section names based on filename for DEMO_MODE."""
        stubs = {
            "interest_calc.cbl": [
                "IDENTIFICATION DIVISION",
                "DATA DIVISION",
                "CALC-INTEREST-SECTION",
                "DETERMINE-TIER-SECTION",
                "OUTPUT-RESULTS-SECTION",
            ],
            "account_master.cbl": [
                "IDENTIFICATION DIVISION",
                "DATA DIVISION",
                "LOOKUP-ACCOUNT-SECTION",
                "UPDATE-ACCOUNT-SECTION",
            ],
            "end_of_day_batch.cbl": [
                "IDENTIFICATION DIVISION",
                "DATA DIVISION",
                "INIT-SECTION",
                "PROCESS-ACCOUNTS-SECTION",
                "CALC-EOD-SECTION",
                "CLOSE-SECTION",
            ],
        }
        return stubs.get(filename, ["MAIN-SECTION"])
