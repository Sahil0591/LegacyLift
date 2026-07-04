"""
core/layer0_5/target_profile_registry.py - Enterprise target profile catalog.

This registry is the backend source of truth for target rollout state. Profiles
marked codegen_supported have target-aware generation, static validation, and a
CI smoke fixture; non-Python targets are still explicitly experimental.
"""

from __future__ import annotations

from models.target_profile import (
    TargetProfileDefinition,
    TargetProfileId,
    TargetProfileStatus,
)


class TargetProfileNotFoundError(LookupError):
    """Raised when a target profile id or alias cannot be resolved."""


def _profile_not_found(value: str) -> TargetProfileNotFoundError:
    available = ", ".join(sorted(_PROFILES_BY_ID))
    return TargetProfileNotFoundError(
        f"Target profile '{value}' was not found. Available profiles: {available}."
    )


def _normalize(value: TargetProfileId | str) -> str:
    if isinstance(value, TargetProfileId):
        value = value.value
    return " ".join(str(value).strip().casefold().split())


def _profile_copy(profile: TargetProfileDefinition) -> TargetProfileDefinition:
    return profile.model_copy(deep=True)


_PROFILES: tuple[TargetProfileDefinition, ...] = (
    TargetProfileDefinition(
        id=TargetProfileId.PYTHON_3X,
        display_name="Python 3.x",
        language="Python",
        version="3.x",
        tagline="Pragmatic target for analytics, internal tooling, and fast demo migration.",
        use_cases=(
            "Analytics workflows",
            "Internal tooling",
            "Fast demo migration",
        ),
        runtime_description=(
            "CPython 3.x runtime with virtual-environment dependency isolation and "
            "clear separation between generated business logic and framework glue."
        ),
        numeric_policy=(
            "Use decimal.Decimal for money and regulated calculations. Avoid float "
            "for financial quantities unless source behavior explicitly requires it."
        ),
        date_policy=(
            "Use datetime.date and datetime.datetime with explicit timezone handling "
            "when timestamps cross system boundaries."
        ),
        test_framework="pytest",
        style_guide="PEP 8 with typed public functions and small modules.",
        type_system_guidance=(
            "Use type hints for public interfaces and dataclasses or Pydantic models "
            "for structured records."
        ),
        async_concurrency_model=(
            "Use asyncio for I/O concurrency. Use worker processes or external jobs "
            "for CPU-heavy workloads."
        ),
        migration_guidance=(
            "Preserve business-rule names from archaeology artifacts.",
            "Externalize hardcoded thresholds into named constants or configuration.",
            "Keep generated modules reviewable before integrating with services.",
        ),
        risk_check_focus=(
            "Decimal precision",
            "Implicit null or blank handling",
            "Global state from legacy working storage",
            "File encoding and fixed-width records",
        ),
        recommended_libraries=(
            "decimal",
            "datetime",
            "pydantic",
            "pytest",
        ),
        aliases=(
            "Python",
            "python",
            "Python 3",
            "Python 3.x",
            "Python 3.12",
            "py3",
        ),
        status=TargetProfileStatus.ACTIVE,
        codegen_supported=True,
    ),
    TargetProfileDefinition(
        id=TargetProfileId.JAVA_21,
        display_name="Java 21 / 25",
        language="Java",
        version="21 LTS with Java 25 readiness",
        tagline="Enterprise target for core banking, services, and payment workloads.",
        use_cases=(
            "Core banking modernization",
            "Enterprise services",
            "Payments platforms",
        ),
        runtime_description=(
            "JVM target centered on Java 21 LTS, with profile guidance kept compatible "
            "with forward-looking Java 25 enterprise adoption."
        ),
        numeric_policy=(
            "Use BigDecimal for money and deterministic decimal arithmetic. Avoid "
            "double for ledgers, fees, limits, and settlement amounts."
        ),
        date_policy=(
            "Use java.time types. Keep time zones explicit at integration boundaries "
            "and avoid legacy Date or Calendar APIs."
        ),
        test_framework="JUnit 5",
        style_guide="Modern Java service style with clear packages, records where appropriate, and explicit domain types.",
        type_system_guidance=(
            "Use strong domain types, records for immutable value carriers, sealed "
            "types where they clarify constrained variants, and Optional at API edges."
        ),
        async_concurrency_model=(
            "Use structured concurrency or virtual threads for high-throughput I/O. "
            "Keep transactional boundaries explicit."
        ),
        migration_guidance=(
            "Model business rules as named services or domain functions.",
            "Prefer explicit DTOs and value objects over untyped maps.",
            "Preserve audit and transaction semantics before optimizing structure.",
        ),
        risk_check_focus=(
            "BigDecimal scale and rounding",
            "Checked exception translation",
            "Transaction boundaries",
            "Thread safety and shared mutable state",
        ),
        recommended_libraries=(
            "java.math.BigDecimal",
            "java.time",
            "JUnit 5",
            "AssertJ",
        ),
        aliases=(
            "Java",
            "Java 21",
            "Java 25",
            "JVM",
        ),
        status=TargetProfileStatus.ACTIVE_EXPERIMENTAL,
        codegen_supported=True,
    ),
    TargetProfileDefinition(
        id=TargetProfileId.CSHARP_DOTNET,
        display_name="C# / .NET",
        language="C#",
        version=".NET current enterprise track",
        tagline="Target for Microsoft-heavy enterprise workflow modernization.",
        use_cases=(
            "Microsoft-heavy enterprise workflows",
            "Line-of-business applications",
            "Azure-integrated services",
        ),
        runtime_description=(
            ".NET runtime profile for organizations standardizing on C#, Azure, "
            "SQL Server, and Microsoft identity or workflow platforms."
        ),
        numeric_policy=(
            "Use decimal for financial values and explicit MidpointRounding choices. "
            "Avoid double for business balances or reconciliation."
        ),
        date_policy=(
            "Use DateOnly, TimeOnly, DateTimeOffset, or NodaTime-style abstractions "
            "where boundary precision matters."
        ),
        test_framework="xUnit or NUnit",
        style_guide="Microsoft C# coding conventions with nullable reference types enabled.",
        type_system_guidance=(
            "Use nullable reference types, records for immutable values, and explicit "
            "domain types for identifiers and money."
        ),
        async_concurrency_model=(
            "Use async/await for I/O and Task-based APIs. Keep blocking calls out of "
            "request paths."
        ),
        migration_guidance=(
            "Map workflow steps into explicit services or handlers.",
            "Keep integration contracts stable for downstream Microsoft systems.",
            "Represent approval and audit state as first-class domain data.",
        ),
        risk_check_focus=(
            "Nullable reference handling",
            "Decimal rounding",
            "Entity Framework transaction behavior",
            "Async deadlocks from sync-over-async code",
        ),
        recommended_libraries=(
            "System.Decimal",
            "System.DateTimeOffset",
            "xUnit",
            "FluentAssertions",
        ),
        aliases=(
            "C#",
            "CSharp",
            "CSharp .NET",
            ".NET",
            "dotnet",
        ),
        status=TargetProfileStatus.ACTIVE_EXPERIMENTAL,
        codegen_supported=True,
    ),
    TargetProfileDefinition(
        id=TargetProfileId.CPP_23,
        display_name="C++23",
        language="C++",
        version="23",
        tagline="Target for latency-sensitive trading, pricing, and risk engines.",
        use_cases=(
            "Low-latency trading",
            "Pricing engines",
            "Risk engines",
        ),
        runtime_description=(
            "Native compiled target for teams that need deterministic latency, "
            "careful memory ownership, and close control of runtime behavior."
        ),
        numeric_policy=(
            "Use fixed-point, decimal, or vetted quant libraries for money. Avoid "
            "silent binary floating-point drift in settlement-sensitive logic."
        ),
        date_policy=(
            "Use chrono types with explicit calendars and time-zone assumptions. "
            "Document exchange calendars and cut-off rules separately."
        ),
        test_framework="GoogleTest or Catch2",
        style_guide="C++ Core Guidelines with RAII, narrow interfaces, and explicit ownership.",
        type_system_guidance=(
            "Prefer value types, spans/views for non-owning access, smart pointers "
            "for ownership, and templates only where they reduce duplication safely."
        ),
        async_concurrency_model=(
            "Use explicit thread pools, event loops, or low-latency messaging. Avoid "
            "hidden shared state in generated logic."
        ),
        migration_guidance=(
            "Separate pure pricing or risk functions from I/O adapters.",
            "Make ownership and lifetime assumptions reviewable.",
            "Preserve deterministic ordering and rounding before tuning performance.",
        ),
        risk_check_focus=(
            "Integer overflow",
            "Object lifetime",
            "Floating-point drift",
            "Data races and lock contention",
        ),
        recommended_libraries=(
            "chrono",
            "GoogleTest",
            "Catch2",
            "fmt",
        ),
        aliases=(
            "C++",
            "C++23",
            "CPP",
            "CPP23",
        ),
        status=TargetProfileStatus.ACTIVE_EXPERIMENTAL,
        codegen_supported=True,
    ),
    TargetProfileDefinition(
        id=TargetProfileId.RUST_2024,
        display_name="Rust 2024",
        language="Rust",
        version="2024 edition",
        tagline="Target for safe high-performance modernization.",
        use_cases=(
            "Safe high-performance modernization",
            "Systems services",
            "Memory-safe data processing",
        ),
        runtime_description=(
            "Rust edition profile for teams prioritizing memory safety, predictable "
            "performance, and explicit error handling."
        ),
        numeric_policy=(
            "Use rust_decimal or fixed-point domain types for money. Keep overflow "
            "behavior explicit with checked, saturating, or wrapping operations."
        ),
        date_policy=(
            "Use chrono or time with explicit timezone and parsing policy. Avoid "
            "implicit local-time assumptions."
        ),
        test_framework="cargo test",
        style_guide="Rust API guidelines with clippy and rustfmt.",
        type_system_guidance=(
            "Use enums for constrained states, Result for recoverable failures, and "
            "newtypes for domain identifiers and units."
        ),
        async_concurrency_model=(
            "Use async runtimes such as Tokio where I/O concurrency is required. "
            "Keep sync business-rule code pure when possible."
        ),
        migration_guidance=(
            "Model invalid states out of the generated domain layer.",
            "Prefer explicit Result handling over panics in migrated logic.",
            "Keep FFI and platform adapters outside business-rule modules.",
        ),
        risk_check_focus=(
            "Ownership boundaries",
            "Error propagation",
            "Overflow policy",
            "Async runtime boundaries",
        ),
        recommended_libraries=(
            "rust_decimal",
            "chrono",
            "tokio",
            "proptest",
        ),
        aliases=(
            "Rust",
            "Rust 2024",
            "Rust edition 2024",
        ),
        status=TargetProfileStatus.ACTIVE_EXPERIMENTAL,
        codegen_supported=True,
    ),
    TargetProfileDefinition(
        id=TargetProfileId.SQL_PLSQL,
        display_name="SQL / PL/SQL / T-SQL",
        language="SQL",
        version="PL/SQL and T-SQL enterprise dialects",
        tagline="Target for stored procedures, reconciliation, audit, and settlement logic.",
        use_cases=(
            "Stored procedures",
            "Reconciliation jobs",
            "Audit and settlement workflows",
        ),
        runtime_description=(
            "Database-resident profile for modernization paths that retain governed "
            "logic close to relational data and operational audit trails."
        ),
        numeric_policy=(
            "Use DECIMAL or NUMERIC with explicit precision, scale, and rounding. "
            "Avoid implicit casts that alter settlement values."
        ),
        date_policy=(
            "Use database-native date and timestamp types with explicit timezone and "
            "session settings documented for each dialect."
        ),
        test_framework="tSQLt, utPLSQL, or migration-specific SQL fixtures",
        style_guide="Dialect-specific SQL style with named transactions and reviewable stored procedure boundaries.",
        type_system_guidance=(
            "Represent domain states with constrained columns, lookup tables, and "
            "checked parameters rather than unstructured strings."
        ),
        async_concurrency_model=(
            "Rely on database transaction isolation, locks, queues, and batch windows. "
            "Keep concurrency assumptions visible in procedure contracts."
        ),
        migration_guidance=(
            "Make transaction scopes explicit before moving or consolidating logic.",
            "Preserve audit records and reconciliation checkpoints.",
            "Separate deterministic calculations from orchestration procedures.",
        ),
        risk_check_focus=(
            "Transaction isolation",
            "Implicit conversion",
            "Procedure side effects",
            "Audit trail completeness",
        ),
        recommended_libraries=(
            "utPLSQL",
            "tSQLt",
            "sqlparse",
        ),
        aliases=(
            "SQL",
            "PLSQL",
            "PL/SQL",
            "T-SQL",
            "TSQL",
            "Stored Procedures",
        ),
        status=TargetProfileStatus.ACTIVE_EXPERIMENTAL,
        codegen_supported=True,
    ),
    TargetProfileDefinition(
        id=TargetProfileId.GO_1X,
        display_name="Go",
        language="Go",
        version="1.22+",
        tagline="Experimental target for modern services and operational tooling.",
        use_cases=(
            "Service modernization",
            "Batch tooling",
            "Platform integrations",
        ),
        runtime_description=(
            "Go runtime profile for teams that want simple deployable services, "
            "explicit error handling, and straightforward concurrency."
        ),
        numeric_policy=(
            "Use integer minor units or a decimal library for money. Avoid float64 "
            "for financial values, balances, reconciliation, or settlement."
        ),
        date_policy=(
            "Use time.Time with explicit locations and parsing policy. Avoid "
            "implicit local-time assumptions."
        ),
        test_framework="go test",
        style_guide="Effective Go with gofmt, small interfaces, and explicit error wrapping.",
        type_system_guidance=(
            "Use explicit structs and typed errors. Keep interfaces small and avoid "
            "interface{} or any for domain data."
        ),
        async_concurrency_model=(
            "Use goroutines and channels for concurrency. Carry context.Context "
            "through I/O boundaries and guard shared state with sync primitives."
        ),
        migration_guidance=(
            "Keep business rules in pure functions where possible.",
            "Isolate I/O behind interfaces so generated logic remains reviewable.",
            "Return errors explicitly and wrap them with context.",
        ),
        risk_check_focus=(
            "float64 used for money",
            "nil pointer or nil interface handling",
            "goroutine leaks",
            "error propagation",
        ),
        recommended_libraries=(
            "time",
            "testing",
            "testify",
            "shopspring/decimal",
        ),
        aliases=(
            "Go",
            "Golang",
            "go-1x",
        ),
        status=TargetProfileStatus.ACTIVE_EXPERIMENTAL,
        codegen_supported=True,
    ),
    TargetProfileDefinition(
        id=TargetProfileId.TYPESCRIPT_5X,
        display_name="TypeScript",
        language="TypeScript",
        version="5.x",
        tagline="Experimental target for web and service modernization.",
        use_cases=(
            "Web/service modernization",
            "Typed business-rule packages",
            "Frontend-adjacent workflows",
        ),
        runtime_description=(
            "TypeScript profile for teams that need strict typing, packageable "
            "business rules, and integration with JavaScript service ecosystems."
        ),
        numeric_policy=(
            "Use decimal.js or bigint minor units for money. Never use the JS "
            "number type for financial calculations."
        ),
        date_policy=(
            "Use typed date libraries or Temporal with explicit timezone handling. "
            "Avoid ambiguous Date parsing."
        ),
        test_framework="vitest",
        style_guide="Strict tsconfig with ESLint/Prettier and exhaustive switch handling.",
        type_system_guidance=(
            "Use discriminated unions for state, branded types for identifiers "
            "and money, and avoid any."
        ),
        async_concurrency_model=(
            "Use async/await with typed Promises. Do not leave promises floating."
        ),
        migration_guidance=(
            "Separate pure business rules from framework and I/O code.",
            "Use runtime validation only at integration boundaries.",
            "Keep generated modules tree-shakeable and reviewable.",
        ),
        risk_check_focus=(
            "number type used for money",
            "floating promises",
            "any leaks",
            "timezone-ambiguous Date parsing",
        ),
        recommended_libraries=(
            "decimal.js",
            "zod",
            "vitest",
            "date-fns",
        ),
        aliases=(
            "TypeScript",
            "TS",
            "typescript-5x",
        ),
        status=TargetProfileStatus.ACTIVE_EXPERIMENTAL,
        codegen_supported=True,
    ),
)

_PROFILES_BY_ID: dict[str, TargetProfileDefinition] = {
    str(profile.id): profile for profile in _PROFILES
}

_ALIASES_BY_NORMALIZED_VALUE: dict[str, TargetProfileDefinition] = {}
for _profile in _PROFILES:
    _ALIASES_BY_NORMALIZED_VALUE[_normalize(str(_profile.id))] = _profile
    for _alias in _profile.aliases:
        _ALIASES_BY_NORMALIZED_VALUE[_normalize(_alias)] = _profile


def list_profiles() -> list[TargetProfileDefinition]:
    """Return all target profiles as immutable copies."""

    return [_profile_copy(profile) for profile in _PROFILES]


def get_profile(profile_id: TargetProfileId | str) -> TargetProfileDefinition:
    """Return a target profile by canonical id."""

    normalized_id = _normalize(profile_id)
    profile = _PROFILES_BY_ID.get(normalized_id)
    if profile is None:
        raise _profile_not_found(str(profile_id))
    return _profile_copy(profile)


def resolve_profile(value: TargetProfileId | str) -> TargetProfileDefinition:
    """Resolve a target profile by canonical id or alias."""

    normalized_value = _normalize(value)
    profile = _ALIASES_BY_NORMALIZED_VALUE.get(normalized_value)
    if profile is None:
        raise _profile_not_found(str(value))
    return _profile_copy(profile)
