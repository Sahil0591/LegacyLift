"""
core/layer0/dependency_mapper.py — Module call-graph builder.

The DependencyMapper analyses all uploaded files and builds a directed graph
of which modules/files call which.  In COBOL this means tracking:
  - CALL statements (calling external programs)
  - PERFORM statements (calling internal paragraphs/sections)
  - COPY statements (copybook inclusions)

This graph is used for two things:
  1. Migration ordering — migrate leaf nodes (no outbound calls) first,
     so dependencies are ready before dependents.
  2. Risk amplification — if a high-risk module is called by many others,
     all callers inherit elevated risk.

Output is an adjacency dict:
  {
    "interest_calc.cbl": ["account_master.cbl"],
    "end_of_day_batch.cbl": ["interest_calc.cbl", "account_master.cbl"],
    "account_master.cbl": [],
  }

Pipeline position: Step 3 of Layer 0, runs after BusinessExtractor.
Output broadcast as 'dependency_graph_ready' WebSocket event.
"""

from __future__ import annotations

import os
import re
from typing import Any

from rich.console import Console

from legacylift.models.project import Project

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


class DependencyMapper:
    """
    Builds a directed dependency graph from static analysis of source files.

    Does NOT use the LLM — dependency detection is rule-based for speed and
    reliability.  The LLM would be overkill here and introduces latency.
    """

    async def build_graph(self, project: Project) -> dict[str, list[str]]:
        """
        Build a dependency graph for all uploaded project files.

        Args:
            project: Project with .files populated.

        Returns:
            Adjacency dict mapping filename -> list of filenames it depends on.
            Keys include ALL files even if they have no dependencies (empty list).

        TODO (implementer):
          - For COBOL: scan each file for CALL 'X' statements.
            Extract the called program name and find the matching file.
          - For COBOL: scan for COPY statements (copybook inclusions).
            These are compile-time dependencies, not runtime, but still matter.
          - For COBOL: scan for PERFORM statements to build the intra-file
            paragraph call graph (separate from inter-file graph).
          - For Java: parse import statements for inter-class dependencies.
          - Handle name mangling: COBOL program names are often different from
            filenames (e.g. CALL 'INTCALC' -> interest_calc.cbl).
          - Use topological sort on the result to determine migration order.
        """
        if DEMO_MODE:
            console.print("[dim]DependencyMapper.build_graph() → returning stub graph[/dim]")

        # PLACEHOLDER — real implementation scans source with regex / tree-sitter
        graph: dict[str, list[str]] = {}

        for f in project.files:
            graph[f.filename] = self._detect_dependencies_stub(
                f.filename, f.content or "", project
            )

        return graph

    def _detect_dependencies_stub(
        self, filename: str, content: str, project: Project
    ) -> list[str]:
        """
        Stub dependency detector.

        TODO (implementer):
          - Replace with real CALL/PERFORM/COPY parser.
          - Use regex initially:
              CALL_PATTERN = re.compile(r"CALL\s+'([^']+)'", re.IGNORECASE)
            Then graduate to tree-sitter AST walk for robustness.
        """
        known_deps = {
            "end_of_day_batch.cbl": ["interest_calc.cbl", "account_master.cbl"],
            "interest_calc.cbl":    ["account_master.cbl"],
            "account_master.cbl":   [],
        }
        # Fall back: try to detect CALL patterns in content
        if filename not in known_deps:
            call_pattern = re.compile(r"CALL\s+'?([A-Z0-9\-]+)'?", re.IGNORECASE)
            found: list[str] = []
            for m in call_pattern.finditer(content):
                called_name = m.group(1).lower()
                # Try to match against uploaded filenames
                for f in project.files:
                    base = os.path.splitext(f.filename)[0].lower()
                    if called_name in base or base in called_name:
                        found.append(f.filename)
            return list(set(found))

        return known_deps[filename]

    def get_migration_order(self, graph: dict[str, list[str]]) -> list[str]:
        """
        Topological sort of the dependency graph to determine migration order.

        Files with no dependencies are migrated first.  Files that depend on
        others are migrated after their dependencies are done.

        Args:
            graph: Adjacency dict from build_graph().

        Returns:
            Ordered list of filenames, leaf nodes first.

        TODO (implementer):
          - Implement Kahn's algorithm or DFS-based topo sort.
          - Handle cycles (circular COBOL PERFORM chains are possible).
            Detect them and report as a warning — break cycles by cutting
            the lowest-call-count edge.
        """
        # PLACEHOLDER: reverse sort by number of dependencies (approximation)
        return sorted(graph.keys(), key=lambda f: len(graph.get(f, [])))
