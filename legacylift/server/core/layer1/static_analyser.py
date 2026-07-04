"""
core/layer1/static_analyser.py — Static structural analysis of migrated code.

Layer 1 is the first quality gate after a human selects a chunk and an LLM
proposes a target-language migration. It is fast, deterministic, and makes NO
LLM calls and NO external API calls.

Checks (execution order):
  5. Empty output detection    — BLOCKING  (short-circuits all other checks)
  1. Branch count matching     — BLOCKING  if counts differ by > 1
  2. Deprecated pattern        — WARNING only
  3. Gotcha detection          — BLOCKING for CRITICAL items
  4. Business rule coverage    — WARNING only

Public API:
  analyse(inp: StaticAnalysisInput) -> StaticAnalysisResult
    Never raises.  Returns a failed result with ANALYSER_ERROR code if an
    unexpected exception escapes the per-check try/except guards.

Legacy API (kept for pipeline.py backward compatibility):
  StaticAnalyser class with async def analyse(self, chunk: MigrationChunk)
"""

from __future__ import annotations

import ast
import logging
import os
import re
import textwrap
from dataclasses import dataclass, field

from rich.console import Console

from models.business_rule import BusinessRule
from models.chunk import MigrationChunk
from models.chunk import StaticAnalysisResult as _LegacyStaticAnalysisResult
from utils.code_parser import CodeChunk
from core.layer1.language_validators import validate_target_code

logger = logging.getLogger(__name__)
console = Console()
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


# ---------------------------------------------------------------------------
# Data contracts  (dataclass-only; no Pydantic)
# ---------------------------------------------------------------------------

@dataclass
class StaticIssue:
    code: str
    severity: str       # "error" | "warning"
    message: str
    line: int | None = None


@dataclass
class StaticAnalysisInput:
    chunk: CodeChunk
    migrated_code: str
    business_rule: BusinessRule
    deprecation_map: list = field(default_factory=list)
    gotcha_registry: list = field(default_factory=list)


@dataclass
class StaticAnalysisResult:
    passed: bool
    issues: list[StaticIssue]
    warnings: list[StaticIssue]
    branch_count_original: int
    branch_count_migrated: int
    has_deprecated_patterns: bool
    deprecated_patterns_found: list[str]
    gotchas_triggered: list[str]
    retry_recommended: bool
    summary: str


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyse(inp: StaticAnalysisInput) -> StaticAnalysisResult:
    """
    Run all static checks on a proposed Python migration.

    This dataclass path is still the Python-specific analyzer used by older
    call sites. The class wrapper below dispatches non-Python targets to the
    language-aware validator layer.

    Never raises.  On unexpected crash returns a failed result with
    ANALYSER_ERROR so the pipeline can retry without an unhandled exception.
    """
    try:
        return _run_all_checks(inp)
    except Exception as e:
        logger.error("Static analysis crashed: %s", e, exc_info=True)
        return StaticAnalysisResult(
            passed=False,
            issues=[StaticIssue(
                code="ANALYSER_ERROR",
                severity="error",
                message=f"Static analyser crashed: {e}",
                line=None,
            )],
            warnings=[],
            branch_count_original=0,
            branch_count_migrated=0,
            has_deprecated_patterns=False,
            deprecated_patterns_found=[],
            gotchas_triggered=[],
            retry_recommended=True,
            summary=f"Analysis failed: {e}",
        )


# ---------------------------------------------------------------------------
# Internal orchestrator
# ---------------------------------------------------------------------------

def _run_all_checks(inp: StaticAnalysisInput) -> StaticAnalysisResult:
    errors: list[StaticIssue] = []
    warnings_: list[StaticIssue] = []
    deprecated_patterns_found: list[str] = []
    gotchas_triggered: list[str] = []
    retry_recommended = False
    branch_count_original = 0
    branch_count_migrated = 0

    code = inp.migrated_code

    # ------------------------------------------------------------------
    # CHECK 5 — Empty output detection (must run first; returns early)
    # ------------------------------------------------------------------
    try:
        stripped = code.strip()
        if not stripped or len(stripped.splitlines()) < 5:
            issue = StaticIssue(
                code="EMPTY_MIGRATION",
                severity="error",
                message="Migrated code is empty or fewer than 5 lines",
                line=None,
            )
            return StaticAnalysisResult(
                passed=False,
                issues=[issue],
                warnings=[],
                branch_count_original=0,
                branch_count_migrated=0,
                has_deprecated_patterns=False,
                deprecated_patterns_found=[],
                gotchas_triggered=[],
                retry_recommended=True,
                summary="1 error — retry recommended",
            )
    except Exception as e:
        logger.warning("Check 5 (empty detection) error: %s", e)

    # ------------------------------------------------------------------
    # CHECK 1 — Branch count matching
    # ------------------------------------------------------------------
    try:
        branch_count_original = _count_cobol_branches(inp.chunk.source)
        branch_count_migrated = _count_python_branches(code)
        diff = abs(branch_count_original - branch_count_migrated)
        if diff > 1:
            errors.append(StaticIssue(
                code="BRANCH_MISMATCH",
                severity="error",
                message=(
                    f"Branch count mismatch: COBOL={branch_count_original}, "
                    f"Python={branch_count_migrated} (differ by {diff})"
                ),
                line=None,
            ))
            retry_recommended = True
        elif diff == 1:
            warnings_.append(StaticIssue(
                code="BRANCH_COUNT_WARNING",
                severity="warning",
                message=(
                    f"Branch count differs by 1: COBOL={branch_count_original}, "
                    f"Python={branch_count_migrated}"
                ),
                line=None,
            ))
    except Exception as e:
        logger.warning("Check 1 (branch count) error: %s", e)

    # ------------------------------------------------------------------
    # CHECK 2 — Deprecated pattern detection (warnings only)
    # ------------------------------------------------------------------
    try:
        for pattern in inp.deprecation_map:
            try:
                if hasattr(pattern, "avoid"):
                    avoid_term = pattern.avoid
                    use_instead = getattr(pattern, "use_instead", "")
                else:
                    # Plain strings from current DeprecationMapper are narrative
                    # descriptions, not detectable Python tokens — skip detection.
                    continue

                if avoid_term and avoid_term in code:
                    deprecated_patterns_found.append(avoid_term)
                    msg = (
                        f"Use {use_instead} instead of {avoid_term}"
                        if use_instead
                        else f"Deprecated pattern found: {avoid_term}"
                    )
                    warnings_.append(StaticIssue(
                        code="DEPRECATED_PATTERN",
                        severity="warning",
                        message=msg,
                        line=None,
                    ))
            except Exception as e:
                logger.warning("Deprecation check for one pattern failed: %s", e)
    except Exception as e:
        logger.warning("Check 2 (deprecated patterns) error: %s", e)

    has_deprecated_patterns = bool(deprecated_patterns_found)

    # ------------------------------------------------------------------
    # CHECK 3 — Gotcha detection
    # ------------------------------------------------------------------
    try:
        # 3a: Registry-provided gotchas (structured objects only; strings are
        #     narrative descriptions without a detectable Python pattern).
        for gotcha in inp.gotcha_registry:
            try:
                if not hasattr(gotcha, "pattern"):
                    continue
                pattern_str = gotcha.pattern
                risk_level = getattr(gotcha, "risk_level", "WARNING").upper()
                description = getattr(gotcha, "description", str(gotcha))

                if pattern_str and re.search(pattern_str, code):
                    gotchas_triggered.append(description)
                    if risk_level == "CRITICAL":
                        errors.append(StaticIssue(
                            code="CRITICAL_GOTCHA",
                            severity="error",
                            message=description,
                            line=None,
                        ))
                        retry_recommended = True
                    else:
                        warnings_.append(StaticIssue(
                            code="GOTCHA_WARNING",
                            severity="warning",
                            message=description,
                            line=None,
                        ))
            except Exception as e:
                logger.warning("Gotcha check for one item failed: %s", e)

        # 3b: Hardcoded safety-net checks (always run)
        if _check_hardcoded_gotchas(code, errors, warnings_, gotchas_triggered):
            retry_recommended = True

    except Exception as e:
        logger.warning("Check 3 (gotcha detection) error: %s", e)

    # ------------------------------------------------------------------
    # CHECK 4 — Business rule keyword coverage
    # ------------------------------------------------------------------
    try:
        _check_rule_coverage(inp.business_rule, code, warnings_)
    except Exception as e:
        logger.warning("Check 4 (rule coverage) error: %s", e)

    # ------------------------------------------------------------------
    # Assemble result
    # ------------------------------------------------------------------
    passed = not errors
    summary = _build_summary(len(errors), len(warnings_), retry_recommended)

    return StaticAnalysisResult(
        passed=passed,
        issues=errors,
        warnings=warnings_,
        branch_count_original=branch_count_original,
        branch_count_migrated=branch_count_migrated,
        has_deprecated_patterns=has_deprecated_patterns,
        deprecated_patterns_found=deprecated_patterns_found,
        gotchas_triggered=gotchas_triggered,
        retry_recommended=retry_recommended,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Branch-counting helpers
# ---------------------------------------------------------------------------

def _count_cobol_branches(source: str) -> int:
    """Count conditional/iteration branch points in COBOL source."""
    patterns = [
        r'\bIF\b',
        r'\bEVALUATE\b',
        r'\bPERFORM\s+UNTIL\b',
        r'\bPERFORM\s+VARYING\b',
    ]
    total = 0
    for pat in patterns:
        total += len(re.findall(pat, source, re.IGNORECASE))
    return total


def _count_python_branches(code: str) -> int:
    """Count conditional/iteration branch points in Python source."""
    branch_re = re.compile(
        r'^\s*(?:if|elif|else\s*:|for|while|case)\b',
        re.MULTILINE,
    )
    return len(branch_re.findall(code))


# ---------------------------------------------------------------------------
# Hardcoded safety-net gotchas (Check 3b)
# ---------------------------------------------------------------------------

def _check_hardcoded_gotchas(
    code: str,
    errors: list[StaticIssue],
    warnings: list[StaticIssue],
    gotchas_triggered: list[str],
) -> bool:
    """
    Four always-on gotcha checks that cover the highest-risk COBOL→Python
    migration mistakes.  Returns True if any CRITICAL issue was found.
    """
    retry = False

    # 1. float used for monetary values — CRITICAL
    if re.search(
        r'\bfloat\b.*(?:amount|balance|price|rate|fee|cost)',
        code,
        re.IGNORECASE,
    ):
        msg = "Never use float for monetary values. Use Decimal."
        gotchas_triggered.append(msg)
        errors.append(StaticIssue(code="CRITICAL_GOTCHA", severity="error", message=msg, line=None))
        retry = True

    # 2. Integer division with / where // may be needed — WARNING
    if re.search(r'\d+\s*/\s*\d+', code) and '//' not in code:
        msg = "Check integer division — COBOL truncates, Python / does not"
        gotchas_triggered.append(msg)
        warnings.append(StaticIssue(code="GOTCHA_WARNING", severity="warning", message=msg, line=None))

    # 3. datetime.utcnow() deprecated — WARNING
    if "datetime.utcnow()" in code:
        msg = "Use datetime.now(timezone.utc) instead of datetime.utcnow()"
        gotchas_triggered.append(msg)
        warnings.append(StaticIssue(code="GOTCHA_WARNING", severity="warning", message=msg, line=None))

    # 4. Bare except clause — WARNING
    if re.search(r'except\s*:', code):
        msg = "Bare except catches everything including KeyboardInterrupt"
        gotchas_triggered.append(msg)
        warnings.append(StaticIssue(code="GOTCHA_WARNING", severity="warning", message=msg, line=None))

    return retry


# ---------------------------------------------------------------------------
# Business rule coverage helper (Check 4)
# ---------------------------------------------------------------------------

_STOP_WORDS: frozenset[str] = frozenset({
    "the", "and", "that", "with", "from", "this", "have", "will",
    "been", "are", "was", "were", "for", "not", "but", "they",
    "which", "when", "what", "their", "into", "there", "than",
    "then", "some", "more", "also", "each", "all", "its", "has",
    "any", "may", "must", "should", "shall", "where", "while",
    "would", "could", "does",
})


def _check_rule_coverage(
    rule: BusinessRule,
    code: str,
    warnings: list[StaticIssue],
) -> None:
    """Warn if fewer than 50% of meaningful keywords from the rule description appear in code."""
    description = getattr(rule, "description", "") or ""
    words = re.findall(r'\b[a-zA-Z]+\b', description)
    meaningful = [w.lower() for w in words if len(w) > 4 and w.lower() not in _STOP_WORDS]
    if not meaningful:
        return
    code_lower = code.lower()
    present = sum(1 for w in meaningful if w in code_lower)
    if present / len(meaningful) < 0.5:
        warnings.append(StaticIssue(
            code="RULE_COVERAGE_LOW",
            severity="warning",
            message="Migrated code may not implement the full business rule",
            line=None,
        ))


# ---------------------------------------------------------------------------
# Summary formatter
# ---------------------------------------------------------------------------

def _build_summary(error_count: int, warning_count: int, retry_recommended: bool) -> str:
    if error_count == 0 and warning_count == 0:
        return "All checks passed"
    parts: list[str] = []
    if error_count:
        parts.append(f"{error_count} error{'s' if error_count != 1 else ''}")
    if warning_count:
        parts.append(f"{warning_count} warning{'s' if warning_count != 1 else ''}")
    suffix = " — retry recommended" if retry_recommended else ""
    return ", ".join(parts) + suffix


# ---------------------------------------------------------------------------
# Legacy StaticAnalyser class  (kept for pipeline.py backward compatibility)
# ---------------------------------------------------------------------------

class StaticAnalyser:
    """
    Async class-based interface used by the existing pipeline.py.
    Calls:  await self._static_analyser.analyse(chunk: MigrationChunk)
    Returns the Pydantic StaticAnalysisResult from models.chunk.
    """

    async def analyse(
        self,
        chunk: MigrationChunk,
        target_language: str = "Python",
    ) -> _LegacyStaticAnalysisResult:
        if DEMO_MODE:
            console.print(
                f"[dim]StaticAnalyser.analyse() -> checking {target_language} "
                f"chunk [{chunk.name}][/dim]"
            )

        code = chunk.migrated_code or "pass"
        validation = validate_target_code(target_language, code)
        if validation.target.id != "python-3x":
            issues = [*validation.issues, *validation.warnings]
            result = _LegacyStaticAnalysisResult(
                passed=validation.passed,
                issues=issues,
                complexity_score=validation.complexity_score,
                line_count=validation.line_count,
            )
            if DEMO_MODE:
                status = "[green]PASS[/green]" if result.passed else "[red]FAIL[/red]"
                console.print(
                    f"  Static analysis ({validation.validator}): {status} | "
                    f"issues={len(issues)} | complexity={result.complexity_score:.1f}"
                )
            return result

        issues: list[str] = []
        critical_found = False

        for issue in self._check_syntax(code):
            issues.append(f"CRITICAL: {issue}")
            critical_found = True

        for issue in self._check_annotations(code):
            issues.append(f"WARNING: {issue}")

        for issue in self._check_float_usage(code):
            issues.append(f"CRITICAL: {issue}")
            critical_found = True

        for issue in self._check_antipatterns(code):
            issues.append(f"WARNING: {issue}")

        complexity, line_count = self._estimate_complexity(code)

        result = _LegacyStaticAnalysisResult(
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

    def _check_syntax(self, code: str) -> list[str]:
        try:
            ast.parse(textwrap.dedent(code))
            return []
        except SyntaxError as e:
            return [f"SyntaxError at line {e.lineno}: {e.msg}"]
        except Exception as e:
            return [f"ParseError: {e}"]

    def _check_annotations(self, code: str) -> list[str]:
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
                        issues.append(f"Function '{node.name}' has unannotated params: {unannotated}")
                    if node.returns is None:
                        issues.append(f"Function '{node.name}' is missing return type annotation")
        except SyntaxError:
            pass
        return issues

    def _check_float_usage(self, code: str) -> list[str]:
        issues: list[str] = []
        financial_re = re.compile(
            r"(balance|amount|rate|interest|fee|total|price|cost|penalty|charge)",
            re.IGNORECASE,
        )
        float_re = re.compile(r"\bfloat\b")
        for i, line in enumerate(code.splitlines(), 1):
            if float_re.search(line) and financial_re.search(line):
                issues.append(
                    f"float used for financial variable at line {i}: '{line.strip()}' — "
                    "use decimal.Decimal instead"
                )
        return issues

    def _check_antipatterns(self, code: str) -> list[str]:
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
        lines = [ln for ln in code.splitlines() if ln.strip() and not ln.strip().startswith("#")]
        decisions = sum(
            len(re.findall(r"\b(if|elif|for|while|except|and|or|case)\b", ln))
            for ln in lines
        )
        return 1.0 + decisions, len(lines)
