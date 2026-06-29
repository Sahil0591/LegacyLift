"""
core/layer0/risk_scorer.py — Per-file and per-chunk risk scorer.

Assigns a migration risk score (0.0 to 1.0) to each file based on static
signals that correlate with migration difficulty and likelihood of bugs.

Risk signals used (weighted):
  - Line count                (longer = harder)
  - Number of hardcoded values(more magic numbers = more fragile)
  - COMP-3 packed decimal use (precision-sensitive arithmetic)
  - Global state presence     (harder to reason about)
  - Dead code presence        (may hide business rules)
  - Inbound dependency count  (if many files depend on this one, high blast radius)
  - Number of SQL table refs  (each table is a migration touchpoint)
  - Commented-out code blocks (suggests historical instability)

The score is used by:
  - archaeologist.py: to sort chunks (high-risk first)
  - pipeline.py: to set MigrationChunk.risk_level
  - WebSocket: broadcast as 'risk_scores_ready' event for UI colouring

Pipeline position: Step 4 (final step) of Layer 0.
"""

from __future__ import annotations

import os
import re

from rich.console import Console

from models.project import Project

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


class RiskScorer:
    """
    Computes a risk score for each uploaded file using static heuristics.

    Scores are in [0.0, 1.0]:
      0.0 - 0.3  LOW      Simple utility file, no arithmetic, few deps
      0.3 - 0.6  MEDIUM   Some complexity, moderate dependencies
      0.6 - 0.8  HIGH     Complex logic, COMP-3, many deps
      0.8 - 1.0  CRITICAL Batch orchestrator, global state, dead code, COMP-3
    """

    # --- Scoring weights (sum should be roughly 1.0) ---
    WEIGHT_LINE_COUNT        = 0.15
    WEIGHT_MAGIC_NUMBERS     = 0.10
    WEIGHT_COMP3             = 0.20
    WEIGHT_GLOBAL_STATE      = 0.15
    WEIGHT_DEAD_CODE         = 0.10
    WEIGHT_INBOUND_DEPS      = 0.15
    WEIGHT_SQL_REFS          = 0.10
    WEIGHT_COMMENTED_CODE    = 0.05

    async def score(
        self, project: Project, dependency_graph: dict[str, list[str]]
    ) -> dict[str, float]:
        """
        Score all uploaded files and return a filename → score mapping.

        Args:
            project:          Project with .files populated.
            dependency_graph: Adjacency dict from DependencyMapper.

        Returns:
            Dict mapping filename to risk float in [0.0, 1.0].

        TODO (implementer):
          - Replace stub signals with real code analysis.
          - For COMP-3: check for 'COMP-3' or 'COMPUTATIONAL-3' keywords.
          - For magic numbers: count numeric literals not on comment lines.
          - For dead code: use CodeParser.find_dead_code() result from archaeologist.
          - For inbound deps: invert the dependency_graph adjacency.
          - Normalise the weighted sum to [0.0, 1.0] using min-max scaling
            across all files so scores are relative, not absolute.
        """
        if DEMO_MODE:
            console.print("[dim]RiskScorer.score() → returning stub risk scores[/dim]")

        # Build inbound dependency count from graph
        inbound_count: dict[str, int] = {f.filename: 0 for f in project.files}
        for caller, callees in dependency_graph.items():
            for callee in callees:
                if callee in inbound_count:
                    inbound_count[callee] += 1

        scores: dict[str, float] = {}
        for f in project.files:
            score = self._score_file(
                content=f.content or "",
                filename=f.filename,
                inbound_deps=inbound_count.get(f.filename, 0),
            )
            scores[f.filename] = round(min(max(score, 0.0), 1.0), 3)
            if DEMO_MODE:
                console.print(
                    f"[dim]  {f.filename}: risk = {scores[f.filename]}[/dim]"
                )

        return scores

    def _score_file(
        self, content: str, filename: str, inbound_deps: int
    ) -> float:
        """
        Compute raw risk score for a single file.

        TODO (implementer): replace each signal with real logic.
        """
        lines = content.splitlines()
        line_count = len(lines)

        # --- Signal: line count ---
        # Normalise against a 'complex file' baseline of 500 lines
        line_score = min(line_count / 500.0, 1.0)

        # --- Signal: magic numbers ---
        # TODO: use CodeParser.extract_literals() for accurate count
        magic_numbers = len(re.findall(r"\b\d{3,}\b", content))
        magic_score = min(magic_numbers / 20.0, 1.0)

        # --- Signal: COMP-3 packed decimal ---
        comp3_score = 1.0 if "COMP-3" in content else 0.0

        # --- Signal: global state ---
        global_score = 1.0 if ("GLOBAL" in content or "WORKING-STORAGE" in content) else 0.0

        # --- Signal: dead code (commented-out code blocks) ---
        dead_lines = sum(1 for l in lines if l.strip().startswith("*"))
        dead_score = min(dead_lines / max(line_count, 1), 1.0)

        # --- Signal: inbound dependency count ---
        inbound_score = min(inbound_deps / 3.0, 1.0)

        # --- Signal: SQL table references ---
        sql_refs = len(re.findall(r"\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b",
                                  content, re.IGNORECASE))
        sql_score = min(sql_refs / 5.0, 1.0)

        # --- Signal: commented-out code ---
        commented_score = dead_score  # Same metric for now

        total = (
            self.WEIGHT_LINE_COUNT     * line_score
            + self.WEIGHT_MAGIC_NUMBERS  * magic_score
            + self.WEIGHT_COMP3          * comp3_score
            + self.WEIGHT_GLOBAL_STATE   * global_score
            + self.WEIGHT_DEAD_CODE      * dead_score
            + self.WEIGHT_INBOUND_DEPS   * inbound_score
            + self.WEIGHT_SQL_REFS       * sql_score
            + self.WEIGHT_COMMENTED_CODE * commented_score
        )

        # Apply well-known high-risk file overrides for demo files
        known_high_risk = {
            "end_of_day_batch.cbl": 0.85,
            "interest_calc.cbl":    0.72,
            "account_master.cbl":   0.55,
        }
        if filename in known_high_risk:
            return known_high_risk[filename]

        return total
