"""
core/target_languages.py - Canonical backend target-language metadata.

This module is intentionally small and dependency-free so generation, static
validation, test generation, and registry code can agree on target ids without
importing the heavier Layer 0.5 registry.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TargetLanguageInfo:
    id: str
    label: str
    language: str
    version: str
    extension: str
    comment_prefix: str
    code_fence: str
    test_framework: str
    numeric_policy: str
    date_policy: str
    style_guide: str
    type_system: str
    async_model: str
    recommended_libraries: tuple[str, ...]
    risk_focus: tuple[str, ...]
    notes: str
    aliases: tuple[str, ...]
    status: str
    codegen_supported: bool


TARGET_LANGUAGES: tuple[TargetLanguageInfo, ...] = (
    TargetLanguageInfo(
        id="python-3x",
        label="Python 3",
        language="Python",
        version="3.12",
        extension=".py",
        comment_prefix="#",
        code_fence="python",
        test_framework="pytest",
        numeric_policy="Use decimal.Decimal for money and regulated calculations; never float.",
        date_policy="Use datetime.date/datetime.datetime with explicit timezone handling.",
        style_guide="PEP 8, typed public functions, small modules.",
        type_system="Type hints on public interfaces; dataclasses or Pydantic for records.",
        async_model="asyncio for I/O; external workers for CPU-heavy workloads.",
        recommended_libraries=("decimal", "datetime", "pydantic", "pytest"),
        risk_focus=("Decimal precision", "blank/null handling", "working-storage state"),
        notes="Active MVP target. All monetary math uses decimal.Decimal.",
        aliases=("Python", "python", "Python 3", "Python 3.12", "py3"),
        status="active",
        codegen_supported=True,
    ),
    TargetLanguageInfo(
        id="java-21",
        label="Java 21",
        language="Java",
        version="21",
        extension=".java",
        comment_prefix="//",
        code_fence="java",
        test_framework="JUnit 5",
        numeric_policy="Use BigDecimal for money; never double for ledgers or settlement.",
        date_policy="Use java.time; avoid Date/Calendar.",
        style_guide="Modern Java service style with explicit domain types.",
        type_system="Records/value objects for immutable data; Optional at API edges.",
        async_model="Virtual threads or structured concurrency for I/O; explicit transactions.",
        recommended_libraries=("java.math.BigDecimal", "java.time", "JUnit 5", "AssertJ"),
        risk_focus=("BigDecimal scale", "transaction boundaries", "shared mutable state"),
        notes="Experimental MVP target. Static validation uses javac when available.",
        aliases=("Java", "Java 21", "JVM"),
        status="active_experimental",
        codegen_supported=True,
    ),
    TargetLanguageInfo(
        id="csharp-dotnet",
        label="C# / .NET",
        language="C#",
        version=".NET 8",
        extension=".cs",
        comment_prefix="//",
        code_fence="csharp",
        test_framework="xUnit",
        numeric_policy="Use decimal for financial values with explicit MidpointRounding.",
        date_policy="Use DateOnly, TimeOnly, or DateTimeOffset where precision matters.",
        style_guide="Microsoft C# conventions with nullable reference types enabled.",
        type_system="Nullable reference types, records, and explicit domain identifiers.",
        async_model="async/await and Task-based APIs; avoid sync-over-async.",
        recommended_libraries=("System.Decimal", "System.DateTimeOffset", "xUnit"),
        risk_focus=("nullable handling", "decimal rounding", "async deadlocks"),
        notes="Experimental MVP target. Static validation uses dotnet build when available.",
        aliases=("C#", "CSharp", "CSharp .NET", ".NET", "dotnet", "csharp-dotnet"),
        status="active_experimental",
        codegen_supported=True,
    ),
    TargetLanguageInfo(
        id="cpp-23",
        label="C++23",
        language="C++",
        version="23",
        extension=".cpp",
        comment_prefix="//",
        code_fence="cpp",
        test_framework="GoogleTest",
        numeric_policy="Use fixed-point, decimal, or integer minor units for money.",
        date_policy="Use chrono with explicit calendar and timezone assumptions.",
        style_guide="C++ Core Guidelines: RAII, narrow interfaces, explicit ownership.",
        type_system="Value types, spans/views, smart pointers for ownership.",
        async_model="Explicit thread pools/event loops; avoid hidden shared state.",
        recommended_libraries=("<chrono>", "GoogleTest", "Catch2", "fmt"),
        risk_focus=("integer overflow", "object lifetime", "data races"),
        notes="Experimental MVP target. Static validation uses g++ or clang++.",
        aliases=("C++", "C++23", "CPP", "CPP23", "cpp-23"),
        status="active_experimental",
        codegen_supported=True,
    ),
    TargetLanguageInfo(
        id="rust-2024",
        label="Rust 2024",
        language="Rust",
        version="2024 edition",
        extension=".rs",
        comment_prefix="//",
        code_fence="rust",
        test_framework="cargo test",
        numeric_policy="Use rust_decimal or fixed-point domain types for money.",
        date_policy="Use chrono or time with explicit timezone/parsing policy.",
        style_guide="Rust API guidelines; rustfmt and clippy clean.",
        type_system="Enums for states, Result for failures, newtypes for identifiers.",
        async_model="Tokio or async runtimes for I/O; keep business rules sync/pure.",
        recommended_libraries=("rust_decimal", "chrono", "tokio", "proptest"),
        risk_focus=("ownership boundaries", "overflow policy", "error propagation"),
        notes="Experimental MVP target. Static validation uses rustc --edition 2024.",
        aliases=("Rust", "Rust 2024", "rust-2024"),
        status="active_experimental",
        codegen_supported=True,
    ),
    TargetLanguageInfo(
        id="sql-plsql",
        label="SQL / PL-SQL",
        language="SQL",
        version="PL/SQL / T-SQL",
        extension=".sql",
        comment_prefix="--",
        code_fence="sql",
        test_framework="tSQLt / utPLSQL",
        numeric_policy="Use DECIMAL/NUMERIC with explicit precision and scale.",
        date_policy="Use database-native date/timestamp types with documented session settings.",
        style_guide="Dialect-specific SQL with named transactions and reviewable procedures.",
        type_system="Constrained columns, lookup tables, checked parameters.",
        async_model="Rely on transaction isolation, locks, queues, and batch windows.",
        recommended_libraries=("utPLSQL", "tSQLt", "sqlparse"),
        risk_focus=("transaction isolation", "implicit conversion", "procedure side effects"),
        notes="Experimental MVP target. Static validation is sqlparse structural validation.",
        aliases=("SQL", "PLSQL", "PL/SQL", "T-SQL", "TSQL", "sql-plsql"),
        status="active_experimental",
        codegen_supported=True,
    ),
    TargetLanguageInfo(
        id="go-1x",
        label="Go",
        language="Go",
        version="1.22+",
        extension=".go",
        comment_prefix="//",
        code_fence="go",
        test_framework="go test",
        numeric_policy="Use integer minor units or decimal library for money; never float64.",
        date_policy="Use time.Time with explicit locations.",
        style_guide="Effective Go / gofmt; return and wrap errors explicitly.",
        type_system="Small interfaces, explicit structs, typed errors.",
        async_model="Goroutines/channels with context cancellation and guarded shared state.",
        recommended_libraries=("time", "testing", "testify", "shopspring/decimal"),
        risk_focus=("float64 money", "nil handling", "goroutine leaks"),
        notes="Experimental MVP target. Static validation uses go test -c when available.",
        aliases=("Go", "Golang", "go-1x"),
        status="active_experimental",
        codegen_supported=True,
    ),
    TargetLanguageInfo(
        id="typescript-5x",
        label="TypeScript",
        language="TypeScript",
        version="5.x",
        extension=".ts",
        comment_prefix="//",
        code_fence="typescript",
        test_framework="vitest",
        numeric_policy="Use decimal.js or bigint minor units for money; never JS number.",
        date_policy="Use typed date libraries or Temporal with explicit time zones.",
        style_guide="strict tsconfig, ESLint/Prettier, exhaustive switch handling.",
        type_system="Discriminated unions, branded types, no any.",
        async_model="async/await with typed Promises; no floating promises.",
        recommended_libraries=("decimal.js", "zod", "vitest", "date-fns"),
        risk_focus=("number money", "floating promises", "any leaks", "timezone parsing"),
        notes="Experimental MVP target. Static validation uses tsc --noEmit.",
        aliases=("TypeScript", "TS", "typescript-5x"),
        status="active_experimental",
        codegen_supported=True,
    ),
)


def _norm(value: str | None) -> str:
    value = "" if value is None else str(value)
    return " ".join(value.strip().casefold().split())


_BY_ALIAS: dict[str, TargetLanguageInfo] = {}
for _target in TARGET_LANGUAGES:
    _BY_ALIAS[_norm(_target.id)] = _target
    _BY_ALIAS[_norm(_target.language)] = _target
    _BY_ALIAS[_norm(_target.label)] = _target
    for _alias in _target.aliases:
        _BY_ALIAS[_norm(_alias)] = _target


def get_target_language(value: str | None) -> TargetLanguageInfo:
    """Resolve a target id, label, or alias to canonical backend metadata."""

    return _BY_ALIAS.get(_norm(value), _BY_ALIAS["python-3x"])


def is_supported_target_language(value: str | None) -> bool:
    """Return True when value is a known target id, label, or alias."""

    target = _BY_ALIAS.get(_norm(value))
    return bool(
        target
        and target.codegen_supported
        and target.status in {"active", "active_experimental"}
    )


def target_profile_payload(value: str | None) -> dict:
    """Return a prompt-compatible target profile payload."""

    target = get_target_language(value)
    return {
        "language": target.language,
        "version": target.version,
        "test_framework": target.test_framework,
        "notes": target.notes,
        "numeric_policy": target.numeric_policy,
        "date_policy": target.date_policy,
        "style_guide": target.style_guide,
        "type_system": target.type_system,
        "async_model": target.async_model,
        "recommended_libraries": list(target.recommended_libraries),
        "risk_focus": list(target.risk_focus),
    }


def safe_identifier(value: str, *, fallback: str = "legacy_lift_migration") -> str:
    ident = re.sub(r"[^0-9a-zA-Z_]+", "_", value).strip("_").lower()
    if not ident:
        ident = fallback
    if ident[0].isdigit():
        ident = f"{fallback}_{ident}"
    return ident


def demo_migration_code(target_value: str | None, *, chunk_id: str, business_rule: str) -> str:
    """Return deterministic sample code for demos and offline tests."""

    target = get_target_language(target_value)
    fn = safe_identifier(chunk_id)
    rule = " ".join(str(business_rule or "").split()) or "No confirmed business rule supplied."
    rule = rule.replace('"""', "'''").replace("*/", "* /")

    if target.id == "python-3x":
        return f'''from decimal import Decimal, ROUND_HALF_UP


def {fn}(
    balance: Decimal,
    annual_interest_rate: Decimal,
    days_in_period: int,
    bonus_rate: Decimal = Decimal("0"),
) -> Decimal:
    """Implement confirmed rule: {rule}"""
    account_master_table = "ACCOUNT_MASTER"
    effective_rate = annual_interest_rate + bonus_rate
    temp_rate = effective_rate / Decimal("100")
    period_factor = Decimal(days_in_period) / Decimal("365")
    interest_amount = balance * temp_rate * period_factor
    return interest_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
'''

    if target.id == "java-21":
        return f'''import java.math.BigDecimal;
import java.math.RoundingMode;

public final class LegacyLiftMigration {{
    private LegacyLiftMigration() {{}}

    /** Implements confirmed rule: {rule} */
    public static BigDecimal {fn}(BigDecimal balance, BigDecimal annualRate, int daysInPeriod) {{
        BigDecimal rate = annualRate.divide(BigDecimal.valueOf(100), 12, RoundingMode.HALF_UP);
        BigDecimal period = BigDecimal.valueOf(daysInPeriod).divide(BigDecimal.valueOf(365), 12, RoundingMode.HALF_UP);
        return balance.multiply(rate).multiply(period).setScale(2, RoundingMode.HALF_UP);
    }}
}}
'''

    if target.id == "csharp-dotnet":
        return f'''using System;

public static class LegacyLiftMigration
{{
    /// <summary>Implements confirmed rule: {rule}</summary>
    public static decimal {fn}(decimal balance, decimal annualRate, int daysInPeriod)
    {{
        var rate = annualRate / 100m;
        var period = daysInPeriod / 365m;
        return Math.Round(balance * rate * period, 2, MidpointRounding.AwayFromZero);
    }}
}}
'''

    if target.id == "cpp-23":
        return f'''// Implements confirmed rule: {rule}
long long {fn}(long long balance_cents, long long rate_basis_points, int days_in_period) {{
    return (balance_cents * rate_basis_points * days_in_period) / (10000LL * 365LL);
}}
'''

    if target.id == "rust-2024":
        return f'''/// Implements confirmed rule: {rule}
pub fn {fn}(balance_cents: i64, rate_basis_points: i64, days_in_period: i64) -> i64 {{
    (balance_cents * rate_basis_points * days_in_period) / (10_000 * 365)
}}
'''

    if target.id == "sql-plsql":
        return f'''-- Implements confirmed rule: {rule}
CREATE OR REPLACE FUNCTION {fn}(
    balance NUMERIC,
    annual_rate NUMERIC,
    days_in_period INTEGER
) RETURNS NUMERIC AS $$
BEGIN
    RETURN ROUND(balance * (annual_rate / 100) * (days_in_period::NUMERIC / 365), 2);
END;
$$ LANGUAGE plpgsql;
'''

    if target.id == "go-1x":
        go_fn = "".join(part.capitalize() for part in fn.split("_")) or "LegacyLiftMigration"
        return f'''package legacylift

// {go_fn} implements confirmed rule: {rule}
func {go_fn}(balanceCents int64, rateBasisPoints int64, daysInPeriod int64) int64 {{
    return (balanceCents * rateBasisPoints * daysInPeriod) / (10000 * 365)
}}
'''

    if target.id == "typescript-5x":
        return f'''// Implements confirmed rule: {rule}
export function {fn}(balanceCents: bigint, rateBasisPoints: bigint, daysInPeriod: bigint): bigint {{
  return (balanceCents * rateBasisPoints * daysInPeriod) / (10000n * 365n);
}}
'''

    return demo_migration_code("python-3x", chunk_id=chunk_id, business_rule=business_rule)
