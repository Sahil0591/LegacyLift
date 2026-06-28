"""
core/layer1/static_analyser.py — Rule-based static analysis of migrated code.

Layer 1 is the FIRST quality gate that migrated Python code passes through.
It runs BEFORE the LLM review (Layer 2) to catch obvious errors cheaply,
without spending AI tokens on code that won't even parse.

Checks performed (in order):
  1. Syntax check: ast.parse() — does the Python parse at all?
  2. Type annotation completeness: are all function params and return types annotated?
  3. Complexity: cyclomatic complexity (McCabe) per function
  4. LegacyLift-specific rules:
     - Is `float` used for any variable that looks financial? → CRITICAL
     - Are bare `except:` clauses present? → WARNING
     - Is `print()` used instead of `logging`? → WARNING
     - Are raw string comparisons used where numeric types are expected? → WARNING

Layer 1 is intentionally strict about CRITICAL issues (fail the chunk) and
lenient about WARNINGs (note them, don't fail).

If the chunk fails Layer 1, the pipeline regenerates it (up to LLM_MAX_RETRIES)
before escalating to human review.

Pipeline position: First step of per-chunk migration, called by pipeline.run_layer1().
"""

from __future__ import annotations

import ast
import os
import re
import textwrap
from typing import Any

from rich.console import Console

from legacylift.models.chunk import MigrationChunk, StaticAnalysisResult

console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


class StaticAnalyser:
    """
    Runs static checks on the migrated Python code for a single chunk.
    """

    async def analyse(self, chunk: MigrationChunk) -> StaticAnalysisResult:
        """
        Run all static checks on the chunk's migrated_code.

        Args:
            chunk: MigrationChunk with migrated_code populated.

        Returns:
            StaticAnalysisResult with passed=True if no CRITICAL issues found.

        TODO (implementer):
          - Add radon for cyclomatic complexity:
              from radon.complexity import cc_visit
              results = cc_visit(chunk.migrated_code)
          - Add mypy for type checking:
              Run mypy programmatically via mypy.api.run()
              Parse the output into StaticAnalysisResult.issues.
          - Add flake8 or ruff for style:
              Run via subprocess.run(['ruff', 'check', '--stdin-filename', 'migrated.py'])
        """
        if DEMO_MODE:
            console.print(
                f"[dim]StaticAnalyser.analyse() → checking chunk [{chunk.name}][/dim]"
            )

        code = chunk.migrated_code or "pass"
        issues: list[str] = []
        critical_found = False

        # --- Check 1: Syntax ---
        syntax_issues = self._check_syntax(code)
        for issue in syntax_issues:
            issues.append(f"CRITICAL: {issue}")
            critical_found = True

        # --- Check 2: Type annotations ---
        annotation_issues = self._check_annotations(code)
        for issue in annotation_issues:
            issues.append(f"WARNING: {issue}")

        # --- Check 3: Financial float usage ---
        float_issues = self._check_float_usage(code)
        for issue in float_issues:
            issues.append(f"CRITICAL: {issue}")
            critical_found = True

        # --- Check 4: Anti-patterns ---
        pattern_issues = self._check_antipatterns(code)
        for issue in pattern_issues:
            issues.append(f"WARNING: {issue}")

        # --- Check 5: Complexity ---
        complexity, line_count = self._estimate_complexity(code)

        result = StaticAnalysisResult(
            passed=not critical_found,
            issues=issues,
            complexity_score=complexity,
            line_count=line_count,
        )

        if DEMO_MODE:
            status = "[green]PASS[/green]" if result.passed else "[red]FAIL[/red]"
            console.print(
                f"  Static analysis: {status} | "
                f"issues={len(issues)} | complexity={complexity:.1f}"
            )

        return result

    # -----------------------------------------------------------------------
    # Individual checks
    # -----------------------------------------------------------------------

    def _check_syntax(self, code: str) -> list[str]:
        """
        Use ast.parse() to check for Python syntax errors.

        Returns:
            List of error strings (empty = no syntax errors).

        TODO (implementer): also run compile() to catch some errors ast.parse()
        misses (though this is rare in Python 3.12).
        """
        try:
            ast.parse(textwrap.dedent(code))
            return []
        except SyntaxError as e:
            return [f"SyntaxError at line {e.lineno}: {e.msg}"]
        except Exception as e:
            return [f"ParseError: {e}"]

    def _check_annotations(self, code: str) -> list[str]:
        """
        Check that all function definitions have type annotations.

        Returns:
            List of warning strings for unannotated parameters.

        TODO (implementer): use ast.walk() to visit FunctionDef nodes and
        check args.annotations and returns annotation completeness.
        """
        issues: list[str] = []
        try:
            tree = ast.parse(textwrap.dedent(code))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    unannotated = [
                        arg.arg for arg in node.args.args
                        if arg.annotation is None and arg.arg != "self"
                    ]
                    if unannotated:
                        issues.append(
                            f"Function '{node.name}' has unannotated params: {unannotated}"
                        )
                    if node.returns is None:
                        issues.append(f"Function '{node.name}' is missing return type annotation")
        except SyntaxError:
            pass  # Syntax errors caught separately
        return issues

    def _check_float_usage(self, code: str) -> list[str]:
        """
        Detect float usage near financial variable names.

        COBOL COMP-3 must be migrated to decimal.Decimal, not float.
        This check catches the most common mistake in COBOL migrations.

        Returns:
            List of CRITICAL issue strings.

        TODO (implementer): use AST to find:
          - float() calls
          - variable annotations with float type
          - function signatures with float params named like bal/amt/rate
        """
        issues: list[str] = []
        financial_patterns = re.compile(
            r"(balance|amount|rate|interest|fee|total|price|cost|penalty|charge)",
            re.IGNORECASE,
        )
        float_pattern = re.compile(r"\bfloat\b")

        lines = code.splitlines()
        for i, line in enumerate(lines, 1):
            if float_pattern.search(line) and financial_patterns.search(line):
                issues.append(
                    f"float used for financial variable at line {i}: '{line.strip()}' — "
                    "use decimal.Decimal instead"
                )
        return issues

    def _check_antipatterns(self, code: str) -> list[str]:
        """
        Check for common Python anti-patterns in migrated code.

        Returns:
            List of WARNING strings.

        TODO (implementer): extend this list based on patterns seen in real
        COBOL migrations at your organisation.
        """
        issues: list[str] = []
        checks = [
            (re.compile(r"^\s*except\s*:", re.MULTILINE), "Bare except: clause — catch specific exceptions"),
            (re.compile(r"\bprint\s*\("),                  "print() used — use logging.info() instead"),
            (re.compile(r"import \*"),                     "Wildcard import — use explicit imports"),
            (re.compile(r"\beval\s*\("),                   "eval() found — security risk, avoid in migrated code"),
        ]
        for pattern, message in checks:
            if pattern.search(code):
                issues.append(message)
        return issues

    def _estimate_complexity(self, code: str) -> tuple[float, int]:
        """
        Estimate cyclomatic complexity and line count.

        Returns:
            (complexity_score, non_blank_line_count)

        Complexity approximation: count decision points (if/for/while/except/and/or).
        True cyclomatic complexity requires radon — install it and replace this.

        TODO (implementer):
            from radon.complexity import cc_visit
            blocks = cc_visit(code)
            complexity = max((b.complexity for b in blocks), default=1)
        """
        lines = [l for l in code.splitlines() if l.strip() and not l.strip().startswith("#")]
        line_count = len(lines)

        # Count decision points as a proxy for cyclomatic complexity
        decision_keywords = re.compile(
            r"\b(if|elif|for|while|except|and|or|case)\b"
        )
        decisions = sum(len(decision_keywords.findall(line)) for line in lines)
        complexity = 1.0 + decisions  # McCabe baseline is 1

        return complexity, line_count
