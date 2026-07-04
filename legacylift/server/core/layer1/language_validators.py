"""
core/layer1/language_validators.py - target-language static validation.

These validators intentionally perform syntax/build checks only. They do not
execute generated business logic or generated tests; that remains disabled
until a locked-down sandbox is available.
"""

from __future__ import annotations

import ast
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import sqlparse

from core.target_languages import TargetLanguageInfo, get_target_language


CommandRunner = Callable[[list[str], Path, int], subprocess.CompletedProcess[str]]


@dataclass
class StaticValidationReport:
    target: TargetLanguageInfo
    passed: bool
    issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    validator: str = ""
    line_count: int = 0
    complexity_score: float = 1.0


def _line_count(code: str) -> int:
    return len([line for line in code.splitlines() if line.strip()])


def _complexity_score(code: str) -> float:
    decisions = len(
        re.findall(r"\b(if|elif|else|for|while|case|catch|except|match|switch|when|and|or)\b", code)
    )
    return float(1 + decisions)


def _run_command(args: list[str], cwd: Path, timeout: int = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _tool_unavailable(tool: str, target: TargetLanguageInfo, reason: str) -> StaticValidationReport:
    return StaticValidationReport(
        target=target,
        passed=False,
        issues=[f"CRITICAL: {target.label} validator unavailable: {reason}"],
        validator=tool,
    )


def _tool_missing(tool: str, target: TargetLanguageInfo) -> StaticValidationReport:
    return _tool_unavailable(tool, target, f"'{tool}' was not found on PATH.")


def _looks_like_toolchain_version_gap(output: str) -> bool:
    """Return True for errors caused by old compilers/SDKs, not generated code."""

    lowered = output.casefold()
    markers = (
        "unknown edition",
        "invalid value '2024'",
        "edition 2024 is unstable",
        "unrecognized command-line option",
        "unknown argument",
        "argument for '--target' option must be",
        "invalid value 'c++23'",
        "unsupported option '-std=c++23'",
        "unrecognized command line option '-std=c++23'",
        "invalid standard",
        "current .net sdk does not support",
        "install the .net framework targeting pack",
        "targeting pack for net8.0 is not installed",
    )
    return any(marker in lowered for marker in markers)


def _looks_like_dependency_resolution_gap(output: str) -> bool:
    """Return True when single-file validation is blocked by missing deps."""

    lowered = output.casefold()
    dependency_markers = (
        "package does not exist",
        "cannot find module",
        "could not find module",
        "cannot find package",
        "no required module provides package",
        "is not in std",
        "unresolved import",
        "unresolved module",
        "unlinked crate",
        "use of undeclared crate or module",
        "could not resolve",
        "error ts2307",
        "cs0246",
        "are you missing a using directive or an assembly reference",
        "no such file or directory",
        "file not found",
    )
    syntax_markers = (
        "syntax error",
        "parse error",
        "unexpected token",
        "unterminated",
        "expected expression",
        "expected statement",
    )
    return (
        any(marker in lowered for marker in dependency_markers)
        and not any(marker in lowered for marker in syntax_markers)
    )


def _dependency_resolution_warning(
    validator: str,
    target: TargetLanguageInfo,
    output: str,
) -> StaticValidationReport:
    return StaticValidationReport(
        target=target,
        passed=True,
        warnings=[
            (
                "WARNING: Static validation could not resolve one or more external "
                f"{target.language} dependencies in this single-file smoke check. "
                "Run the generated code in a project build with declared dependencies "
                f"before approval. Validator output: {output[:600]}"
            )
        ],
        validator=validator,
    )


def _command_report(
    *,
    target: TargetLanguageInfo,
    validator: str,
    args: list[str],
    cwd: Path,
    runner: CommandRunner,
    timeout: int = 20,
) -> StaticValidationReport:
    try:
        proc = runner(args, cwd, timeout)
    except subprocess.TimeoutExpired:
        return StaticValidationReport(
            target=target,
            passed=False,
            issues=[f"CRITICAL: {target.label} static validation timed out using {validator}."],
            validator=validator,
        )
    except OSError as exc:
        return StaticValidationReport(
            target=target,
            passed=False,
            issues=[f"CRITICAL: {target.label} validator failed to start: {exc}"],
            validator=validator,
        )

    if proc.returncode == 0:
        return StaticValidationReport(target=target, passed=True, validator=validator)

    output = "\n".join(part for part in [proc.stdout, proc.stderr] if part).strip()
    if not output:
        output = f"{validator} exited with status {proc.returncode}"
    if _looks_like_toolchain_version_gap(output):
        return _tool_unavailable(
            validator,
            target,
            f"{validator} does not support required {target.version} settings: {output[:600]}",
        )
    if _looks_like_dependency_resolution_gap(output):
        return _dependency_resolution_warning(validator, target, output)
    return StaticValidationReport(
        target=target,
        passed=False,
        issues=[f"CRITICAL: {target.label} static validation failed: {output[:1200]}"],
        validator=validator,
    )


def _public_java_type_name(code: str) -> str:
    match = re.search(r"\bpublic\s+(?:final\s+|abstract\s+)?(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)", code)
    if match:
        return match.group(1)
    return "LegacyLiftStaticCheck"


def _ensure_go_package(code: str) -> str:
    if re.search(r"^\s*package\s+\w+", code, flags=re.MULTILINE):
        return code
    return "package legacylift\n\n" + code


def _tsc_executable() -> str | None:
    found = shutil.which("tsc")
    if found:
        return found

    repo_client = Path(__file__).resolve().parents[3] / "client" / "node_modules" / ".bin"
    cmd = repo_client / ("tsc.cmd" if os.name == "nt" else "tsc")
    if cmd.exists():
        return str(cmd)
    return None


def _cpp_compiler() -> str | None:
    return shutil.which("g++") or shutil.which("clang++")


def _balanced_parentheses(sql: str) -> bool:
    depth = 0
    in_single = False
    in_double = False
    i = 0
    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""

        if not in_single and not in_double and ch == "-" and nxt == "-":
            line_end = sql.find("\n", i)
            i = len(sql) if line_end == -1 else line_end
            continue
        if not in_single and not in_double and ch == "/" and nxt == "*":
            block_end = sql.find("*/", i + 2)
            if block_end == -1:
                return False
            i = block_end + 2
            continue
        if ch == "'" and not in_double:
            if in_single and nxt == "'":
                i += 2
                continue
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif not in_single and not in_double:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth < 0:
                    return False
        i += 1

    return depth == 0 and not in_single and not in_double


def _sql_structural_issues(sql: str) -> list[str]:
    upper = sql.upper()
    issues: list[str] = []

    if not _balanced_parentheses(sql):
        issues.append("CRITICAL: SQL has unbalanced parentheses or unterminated quoted text.")
    if sql.count("$$") % 2:
        issues.append("CRITICAL: SQL dollar-quoted function body is not closed.")
    if re.search(r"\bSELECT\s*(?:FROM|;|$)", upper):
        issues.append("CRITICAL: SQL SELECT statement is missing a projection list.")
    if re.search(r"\b(?:FROM|JOIN)\s*(?:WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|;|$)", upper):
        issues.append("CRITICAL: SQL statement is missing a table name after FROM/JOIN.")
    if re.search(r"\bINSERT\s+INTO\s*(?:VALUES|;|$)", upper):
        issues.append("CRITICAL: SQL INSERT statement is missing a target table.")
    if re.search(r"\bUPDATE\s*(?:SET|WHERE|;|$)", upper):
        issues.append("CRITICAL: SQL UPDATE statement is missing a target table.")
    if re.search(r"\bCREATE\s+OR\s+REPLACE\s+FUNCTION\b", upper):
        if "BEGIN" in upper and not re.search(r"\bEND\s*;\s*\$\$", upper):
            issues.append("CRITICAL: SQL function body has BEGIN without END; before $$ terminator.")

    return issues


def validate_target_code(
    target_language: str,
    code: str,
    *,
    runner: CommandRunner = _run_command,
) -> StaticValidationReport:
    target = get_target_language(target_language)
    stripped = textwrap.dedent(code or "").strip()
    base = StaticValidationReport(
        target=target,
        passed=False,
        validator=target.language,
        line_count=_line_count(stripped),
        complexity_score=_complexity_score(stripped),
    )

    if not stripped:
        base.issues.append("CRITICAL: Migrated code is empty.")
        return base

    if target.id == "python-3x":
        try:
            ast.parse(stripped)
        except SyntaxError as exc:
            base.issues.append(f"CRITICAL: SyntaxError at line {exc.lineno}: {exc.msg}")
            return base
        except Exception as exc:
            base.issues.append(f"CRITICAL: Python parser failed: {exc}")
            return base
        base.passed = True
        base.validator = "ast.parse"
        return base

    if target.id == "sql-plsql":
        statements = [stmt for stmt in sqlparse.parse(stripped) if str(stmt).strip()]
        if not statements:
            base.issues.append("CRITICAL: SQL parser found no statements.")
            return base
        structural_issues = _sql_structural_issues(stripped)
        if structural_issues:
            base.issues.extend(structural_issues)
            base.validator = "sqlparse + structural checks"
            return base
        base.passed = True
        base.validator = "sqlparse + structural checks"
        base.warnings.append(
            "WARNING: SQL validation is structural only; run dialect-specific tests before approval."
        )
        upper = stripped.upper()
        if "CREATE OR REPLACE" in upper and "T-SQL" in target.version.upper():
            base.warnings.append(
                "WARNING: CREATE OR REPLACE is not valid in every SQL Server/T-SQL environment."
            )
        return base

    with tempfile.TemporaryDirectory(prefix="ll_static_") as tmp:
        tmpdir = Path(tmp)

        if target.id == "java-21":
            javac = shutil.which("javac")
            if not javac:
                return _tool_missing("javac", target)
            filename = f"{_public_java_type_name(stripped)}.java"
            (tmpdir / filename).write_text(stripped, encoding="utf-8")
            report = _command_report(
                target=target,
                validator="javac",
                args=[javac, "-Xlint:none", filename],
                cwd=tmpdir,
                runner=runner,
            )

        elif target.id == "rust-2024":
            rustc = shutil.which("rustc")
            if not rustc:
                return _tool_missing("rustc", target)
            (tmpdir / "lib.rs").write_text(stripped, encoding="utf-8")
            report = _command_report(
                target=target,
                validator="rustc",
                args=[rustc, "--edition", "2024", "--crate-type", "lib", "lib.rs"],
                cwd=tmpdir,
                runner=runner,
            )

        elif target.id == "typescript-5x":
            tsc = _tsc_executable()
            if not tsc:
                return _tool_missing("tsc", target)
            (tmpdir / "migration.ts").write_text(stripped, encoding="utf-8")
            report = _command_report(
                target=target,
                validator="tsc",
                args=[tsc, "--noEmit", "--target", "ES2020", "--module", "commonjs", "migration.ts"],
                cwd=tmpdir,
                runner=runner,
            )

        elif target.id == "go-1x":
            go = shutil.which("go")
            if not go:
                return _tool_missing("go", target)
            (tmpdir / "go.mod").write_text("module legacylift_static_check\n\ngo 1.22\n", encoding="utf-8")
            (tmpdir / "migration.go").write_text(_ensure_go_package(stripped), encoding="utf-8")
            report = _command_report(
                target=target,
                validator="go test -c",
                args=[go, "test", "-c", "-o", "static_check.test"],
                cwd=tmpdir,
                runner=runner,
                timeout=30,
            )

        elif target.id == "csharp-dotnet":
            dotnet = shutil.which("dotnet")
            if not dotnet:
                return _tool_missing("dotnet", target)
            try:
                sdk_proc = runner([dotnet, "--list-sdks"], tmpdir, 10)
            except (OSError, subprocess.TimeoutExpired) as exc:
                return _tool_unavailable("dotnet", target, f"dotnet SDK check failed: {exc}")
            if sdk_proc.returncode != 0 or not (sdk_proc.stdout or "").strip():
                return _tool_unavailable(
                    "dotnet",
                    target,
                    "the dotnet runtime is present but no .NET SDK is installed.",
                )
            (tmpdir / "LegacyLift.StaticCheck.csproj").write_text(
                """<Project Sdk=\"Microsoft.NET.Sdk\">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
</Project>
""",
                encoding="utf-8",
            )
            (tmpdir / "Migration.cs").write_text(stripped, encoding="utf-8")
            report = _command_report(
                target=target,
                validator="dotnet build",
                args=[dotnet, "build", "--nologo"],
                cwd=tmpdir,
                runner=runner,
                timeout=45,
            )

        elif target.id == "cpp-23":
            compiler = _cpp_compiler()
            if not compiler:
                return _tool_missing("g++/clang++", target)
            (tmpdir / "migration.cpp").write_text(stripped, encoding="utf-8")
            report = _command_report(
                target=target,
                validator=Path(compiler).name,
                args=[compiler, "-std=c++23", "-fsyntax-only", "migration.cpp"],
                cwd=tmpdir,
                runner=runner,
            )

        else:
            report = StaticValidationReport(
                target=target,
                passed=False,
                issues=[f"CRITICAL: No static validator is registered for {target.language}."],
                validator="none",
            )

    report.line_count = base.line_count
    report.complexity_score = base.complexity_score
    return report
