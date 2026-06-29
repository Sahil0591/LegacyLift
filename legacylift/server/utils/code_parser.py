"""
utils/code_parser.py — Source code parsing via tree-sitter.

This module wraps tree-sitter to give the rest of the pipeline a clean
interface for turning raw source text into structured AST data.

Currently used by:
  - core/layer0/archaeologist.py  — scan COBOL for SECTION/PARAGRAPH names
  - core/layer0/business_extractor.py — find hardcoded literals
  - core/layer1/static_analyser.py — parse migrated Python for syntax errors

tree-sitter works by compiling language grammars into shared libraries.
For COBOL we use a community grammar; Python/Java are first-party.

SETUP NOTE for the implementer:
  tree-sitter >= 0.22 uses a new binding API. You no longer need to call
  Language.build_library(). Instead install pre-built wheels:
    pip install tree-sitter-python  (official)
  For COBOL use the community grammar — see README for build steps.

In DEMO_MODE (no grammar compiled), all parse calls return synthetic AST
dicts so the pipeline can run end-to-end without the grammar installed.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from rich.console import Console

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Lazy grammar imports — fail gracefully if tree-sitter grammars not built
# ---------------------------------------------------------------------------
try:
    import tree_sitter_python as tspython
    from tree_sitter import Language, Parser
    PY_LANGUAGE = Language(tspython.language())
    TREE_SITTER_AVAILABLE = True
except Exception:
    TREE_SITTER_AVAILABLE = False
    if DEMO_MODE:
        console.print(
            "[yellow]code_parser: tree-sitter not available — using stub parser[/yellow]"
        )


# ---------------------------------------------------------------------------
# Public data structures
# ---------------------------------------------------------------------------

class ParsedNode:
    """
    Lightweight wrapper around a tree-sitter Node.

    Provides a dict-serialisable interface so layers can work with parsed
    code without depending directly on the tree-sitter C extension types.
    """

    def __init__(
        self,
        type_: str,
        text: str,
        start_line: int,
        end_line: int,
        children: list["ParsedNode"] | None = None,
    ) -> None:
        self.type = type_
        self.text = text
        self.start_line = start_line
        self.end_line = end_line
        self.children: list[ParsedNode] = children or []

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "text": self.text,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "children": [c.to_dict() for c in self.children],
        }


class CodeParser:
    """
    Thin tree-sitter facade used throughout the pipeline.

    Instantiate once per language; reuse for multiple files.
    Falls back to regex-based stub parsing in DEMO_MODE.
    """

    def __init__(self, language: str = "python") -> None:
        """
        Args:
            language: One of 'python', 'java', 'cobol'. Case-insensitive.

        TODO (implementer): Wire COBOL and Java language grammars.
          - COBOL: compile tree-sitter-cobol grammar, load with Language()
          - Java:  pip install tree-sitter-java, load with Language()
        """
        self.language = language.lower()
        self._parser: Optional[Any] = None

        if TREE_SITTER_AVAILABLE and self.language == "python":
            self._parser = Parser(PY_LANGUAGE)

    # -----------------------------------------------------------------------
    # Public methods
    # -----------------------------------------------------------------------

    def parse(self, source: str) -> list[ParsedNode]:
        """
        Parse source text and return a flat list of top-level AST nodes.

        Args:
            source: Raw source code as a UTF-8 string.

        Returns:
            List of ParsedNode objects representing the top-level
            definitions/paragraphs/sections found.

        TODO (implementer):
          - For Python: use self._parser.parse(source.encode())
          - For COBOL: implement SECTION/PARAGRAPH splitter via regex first,
            then graduate to tree-sitter once grammar is compiled.
          - Return one ParsedNode per COBOL SECTION or Python function/class.
        """
        if self._parser is not None:
            return self._parse_with_tree_sitter(source)
        return self._parse_stub(source)

    def extract_literals(self, source: str) -> list[str]:
        """
        Return all numeric and string literals found in the source.

        Used by business_extractor.py to populate BusinessRule.hardcoded_values.

        Args:
            source: Raw source code text.

        Returns:
            Deduplicated list of literal values, e.g. ['10000', '0.025', '35'].

        TODO (implementer):
          - For Python: walk the AST with ast.walk(ast.parse(source)) and
            yield ast.Constant nodes.
          - For COBOL: regex on VALUE clauses and numeric literals.
        """
        if DEMO_MODE:
            return ["10000", "0.025", "35", "5", "23"]
        # TODO: real implementation
        return []

    def find_dead_code(self, source: str) -> list[tuple[int, int]]:
        """
        Detect unreachable or commented-out code sections.

        Args:
            source: Raw source code text.

        Returns:
            List of (start_line, end_line) tuples for each dead code block.

        TODO (implementer):
          - COBOL: find paragraphs that are never PERFORMed or called.
          - Python: use AST to find code after unconditional return/raise.
        """
        if DEMO_MODE:
            return [(45, 52)]
        return []

    def split_into_chunks(
        self, source: str, max_lines: int = 80
    ) -> list[tuple[str, str, int, int]]:
        """
        Split a source file into pipeline-processable chunks.

        Returns a list of (chunk_name, chunk_source, start_line, end_line).
        Chunks respect COBOL SECTION / PARAGRAPH boundaries or Python
        function / class boundaries.

        Args:
            source:    Full file content.
            max_lines: Soft limit — chunks larger than this are split further.

        Returns:
            List of (name, source_text, start_line, end_line) tuples.

        TODO (implementer):
          - COBOL: split on SECTION / PARAGRAPH headers using regex first,
            then AST-based splitting once grammar is ready.
          - Python: split on top-level function/class definitions.
          - Respect max_lines: if a section exceeds it, split at the nearest
            blank line boundary.
        """
        if DEMO_MODE:
            return self._stub_chunks(source)

        # TODO: real chunker
        lines = source.splitlines()
        return [("FULL-FILE", source, 1, len(lines))]

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    def _parse_with_tree_sitter(self, source: str) -> list[ParsedNode]:
        """Run tree-sitter parser and convert to ParsedNode list."""
        tree = self._parser.parse(source.encode("utf-8"))
        nodes = []
        for child in tree.root_node.children:
            if child.type in ("function_definition", "class_definition"):
                nodes.append(ParsedNode(
                    type_=child.type,
                    text=source[child.start_byte:child.end_byte],
                    start_line=child.start_point[0] + 1,
                    end_line=child.end_point[0] + 1,
                ))
        return nodes

    def _parse_stub(self, source: str) -> list[ParsedNode]:
        """
        Regex-based stub parser used in DEMO_MODE when tree-sitter is
        not available.  Splits COBOL on SECTION/PARAGRAPH headers and Python
        on 'def '/'class ' lines.

        TODO (implementer): remove once tree-sitter grammars are compiled.
        """
        import re
        lines = source.splitlines()
        nodes: list[ParsedNode] = []

        # Try COBOL SECTION pattern first, then fall back to a single node
        cobol_pattern = re.compile(
            r"^([A-Z0-9\-]+)\s+SECTION\.", re.IGNORECASE
        )
        para_pattern = re.compile(
            r"^([A-Z0-9\-]+)\.$", re.IGNORECASE
        )

        current_name = "PREAMBLE"
        current_start = 1
        current_lines: list[str] = []

        for i, line in enumerate(lines, 1):
            m = cobol_pattern.match(line.strip()) or para_pattern.match(line.strip())
            if m and current_lines:
                nodes.append(ParsedNode(
                    type_="section",
                    text="\n".join(current_lines),
                    start_line=current_start,
                    end_line=i - 1,
                ))
                current_name = m.group(1)
                current_start = i
                current_lines = [line]
            else:
                current_lines.append(line)

        if current_lines:
            nodes.append(ParsedNode(
                type_="section",
                text="\n".join(current_lines),
                start_line=current_start,
                end_line=len(lines),
            ))

        # If no structure found, treat entire file as one chunk
        if not nodes:
            nodes.append(ParsedNode(
                type_="file",
                text=source,
                start_line=1,
                end_line=len(lines),
            ))

        return nodes

    def _stub_chunks(
        self, source: str
    ) -> list[tuple[str, str, int, int]]:
        """Return canned demo chunks so the pipeline has something to process."""
        nodes = self._parse_stub(source)
        return [
            (n.type.upper() + f"_{i}", n.text, n.start_line, n.end_line)
            for i, n in enumerate(nodes, 1)
        ]
