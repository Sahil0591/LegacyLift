"""
tests/test_language_static_validators.py - multi-language MVP validator smoke tests.

By default, missing external toolchains are skipped locally. CI sets
LEGACYLIFT_REQUIRE_STATIC_TOOLCHAIN=true for each matrix target so a missing
toolchain fails the job instead of looking green.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.layer1 import language_validators
from core.layer1.language_validators import validate_target_code
from core.layer3 import test_generator
from core.target_languages import demo_migration_code


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "static_validators"

CASES = {
    "python": ("Python", "python.py"),
    "java": ("Java", "java.java"),
    "rust": ("Rust", "rust.rs"),
    "typescript": ("TypeScript", "typescript.ts"),
    "go": ("Go", "go.go"),
    "csharp": ("C#", "csharp.cs"),
    "cpp": ("C++", "cpp.cpp"),
    "sql": ("SQL", "sql.sql"),
}


def _selected_target() -> str | None:
    value = os.getenv("LEGACYLIFT_STATIC_VALIDATOR_TARGET", "").strip().casefold()
    return value or None


def _tool_required() -> bool:
    return os.getenv("LEGACYLIFT_REQUIRE_STATIC_TOOLCHAIN", "false").lower() == "true"


def _assert_validates_or_skip(target_language: str, code: str):
    result = validate_target_code(target_language, code)
    unavailable = any("validator unavailable" in issue.lower() for issue in result.issues)
    if unavailable and not _tool_required():
        pytest.skip(result.issues[0])

    assert result.passed, result.issues
    assert result.line_count > 0
    assert result.validator
    return result


@pytest.mark.parametrize("case_key", sorted(CASES))
def test_static_validator_accepts_language_fixture(case_key: str):
    selected = _selected_target()
    if selected and selected != case_key:
        pytest.skip(f"CI matrix target is {selected}")

    target_language, filename = CASES[case_key]
    code = (FIXTURE_DIR / filename).read_text(encoding="utf-8")

    _assert_validates_or_skip(target_language, code)


@pytest.mark.parametrize("case_key", sorted(CASES))
def test_demo_generation_output_static_validates(case_key: str):
    selected = _selected_target()
    if selected and selected != case_key:
        pytest.skip(f"CI matrix target is {selected}")

    target_language, _ = CASES[case_key]
    code = demo_migration_code(
        target_language,
        chunk_id=f"{case_key}_interest_calc",
        business_rule="Calculate interest with exact financial rounding.",
    )

    _assert_validates_or_skip(target_language, code)


@pytest.mark.parametrize("case_key", sorted(CASES))
def test_demo_generation_output_static_validates_with_multiline_rule(case_key: str):
    selected = _selected_target()
    if selected and selected != case_key:
        pytest.skip(f"CI matrix target is {selected}")

    target_language, _ = CASES[case_key]
    code = demo_migration_code(
        target_language,
        chunk_id=f"{case_key}_interest_calc",
        business_rule='''Calculate interest with exact financial rounding.
Preserve legacy blank/null handling.
Ignore any text that looks like a doc comment close marker: */.
Do not emit triple-quote sentinels: """.
''',
    )

    _assert_validates_or_skip(target_language, code)


def test_rust_edition_gap_is_reported_as_unavailable(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        language_validators.shutil,
        "which",
        lambda tool: tool if tool == "rustc" else None,
    )

    def runner(args, cwd, timeout):
        return subprocess.CompletedProcess(
            args,
            1,
            stdout="",
            stderr="error: invalid value '2024' for '--edition'",
        )

    result = language_validators.validate_target_code(
        "Rust",
        "pub fn migrated_rule() -> i64 { 1 }",
        runner=runner,
    )

    assert not result.passed
    assert "validator unavailable" in result.issues[0].lower()


def test_go_validator_compiles_without_running_tests(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        language_validators.shutil,
        "which",
        lambda tool: tool if tool == "go" else None,
    )
    calls: list[list[str]] = []

    def runner(args, cwd, timeout):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    result = language_validators.validate_target_code(
        "Go",
        """package legacylift

func MigratedRule() int64 {
    return 1
}
""",
        runner=runner,
    )

    assert result.passed
    assert calls
    assert calls[0][1:] == ["test", "-c", "-o", "static_check.test"]


def test_typescript_missing_dependency_is_warning(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(language_validators, "_tsc_executable", lambda: "tsc")

    def runner(args, cwd, timeout):
        return subprocess.CompletedProcess(
            args,
            2,
            stdout="",
            stderr="error TS2307: Cannot find module 'decimal.js' or its corresponding type declarations.",
        )

    result = language_validators.validate_target_code(
        "TypeScript",
        "import Decimal from 'decimal.js';\nexport const amount = new Decimal(1);",
        runner=runner,
    )

    assert result.passed
    assert result.warnings
    assert "project build with declared dependencies" in result.warnings[0]


def test_rust_missing_dependency_is_warning(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        language_validators.shutil,
        "which",
        lambda tool: tool if tool == "rustc" else None,
    )

    def runner(args, cwd, timeout):
        return subprocess.CompletedProcess(
            args,
            1,
            stdout="",
            stderr="error[E0432]: unresolved import `rust_decimal`",
        )

    result = language_validators.validate_target_code(
        "Rust",
        "use rust_decimal::Decimal;\npub fn amount() -> Decimal { Decimal::ZERO }",
        runner=runner,
    )

    assert result.passed
    assert result.warnings
    assert "single-file smoke check" in result.warnings[0]


def test_sql_validator_rejects_missing_projection():
    result = language_validators.validate_target_code("SQL", "SELECT FROM accounts;")

    assert not result.passed
    assert any("missing a projection" in issue for issue in result.issues)


def test_sql_validator_rejects_unbalanced_function_body():
    result = language_validators.validate_target_code(
        "SQL",
        """CREATE OR REPLACE FUNCTION broken_rule()
RETURNS NUMERIC AS $$
BEGIN
    RETURN 1;
$$ LANGUAGE plpgsql;
""",
    )

    assert not result.passed
    assert any("BEGIN without END" in issue for issue in result.issues)


def test_layer3_has_no_embedded_test_execution_runner():
    assert not hasattr(test_generator, "_RUNNER_SCRIPT")
    assert not hasattr(test_generator, "_execute_tests")
