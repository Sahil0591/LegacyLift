// lib/targetLanguages.ts - The catalog of languages LegacyLift can migrate INTO.
//
// Legacy migrations don't fan into a single language: core banking tends to go
// to Java, stored procedures stay in SQL/PL-SQL, analytics goes to Python, and
// so on. This catalog carries the per-language guidance the AI needs to produce
// *idiomatic* target code (not "Python with a different name") - numeric/money
// policy, date handling, typing, style, concurrency, and the test framework.
//
// Mirrors the backend MVP target catalog. Python is the active baseline; the
// other targets are explicit experimental MVP targets until sandboxed execution
// and deeper project-level dependency resolution are implemented.

export type TargetLanguageStatus = "active" | "active_experimental";

export interface TargetLanguage {
  /** Stable id, persisted in project config (never render this). */
  id: string;
  /** Short human label for dropdowns, e.g. "Java 21". */
  label: string;
  /** Canonical language name sent to the backend as `target_lang`. */
  language: string;
  version: string;
  /** File extension for assembled output, incl. the dot. */
  extension: string;
  /** Line-comment prefix for generated file headers. */
  commentPrefix: string;
  /** Product maturity shown in UI; non-Python MVP targets are experimental. */
  status: TargetLanguageStatus;
  /** True only when generation, static validation, and CI fixtures exist. */
  codegenSupported: boolean;
  testFramework: string;
  styleGuide: string;
  typeSystem: string;
  numericPolicy: string;
  datePolicy: string;
  asyncModel: string;
  recommendedLibraries: string[];
  riskFocus: string[];
  /** One-line summary shown in the prompt's target profile. */
  notes: string;
}

/** Snake-case payload matching the backend `_TargetProfileIn` shape. */
export interface TargetProfilePayload {
  language: string;
  version: string;
  test_framework: string;
  notes: string;
  numeric_policy: string;
  date_policy: string;
  style_guide: string;
  type_system: string;
  async_model: string;
  recommended_libraries: string[];
  risk_focus: string[];
}

export const TARGET_LANGUAGES: TargetLanguage[] = [
  {
    id: "python-3x",
    label: "Python 3",
    language: "Python",
    version: "3.12",
    extension: ".py",
    commentPrefix: "#",
    status: "active",
    codegenSupported: true,
    testFramework: "pytest",
    styleGuide: "PEP 8, formatted with Black; small, typed modules.",
    typeSystem:
      "Full type hints on public interfaces; dataclasses or Pydantic for structured records.",
    numericPolicy:
      "Use decimal.Decimal for money and regulated calculations - never float. Reproduce COBOL COMPUTE … ROUNDED with ROUND_HALF_UP.",
    datePolicy:
      "Use datetime.date / datetime.datetime with explicit time zones when timestamps cross system boundaries.",
    asyncModel:
      "asyncio for I/O concurrency; worker processes or external jobs for CPU-heavy work.",
    recommendedLibraries: ["decimal", "datetime", "pydantic", "pytest"],
    riskFocus: [
      "Decimal precision",
      "Implicit null/blank handling",
      "Global state from legacy working storage",
      "File encoding and fixed-width records",
    ],
    notes: "Analytics, internal tooling, fast migration. All money math uses decimal.Decimal.",
  },
  {
    id: "java-21",
    label: "Java 21",
    language: "Java",
    version: "21",
    extension: ".java",
    commentPrefix: "//",
    status: "active_experimental",
    codegenSupported: true,
    testFramework: "JUnit 5",
    styleGuide:
      "Modern Java service style - clear packages, records where appropriate, explicit domain types.",
    typeSystem:
      "Strong domain types, records for immutable values, sealed types for constrained variants, Optional at API edges.",
    numericPolicy:
      "Use BigDecimal for money and deterministic decimal arithmetic - never double for ledgers, fees, limits, or settlement. Set scale and RoundingMode explicitly.",
    datePolicy:
      "Use java.time types; keep time zones explicit at integration boundaries; avoid legacy Date/Calendar.",
    asyncModel:
      "Structured concurrency or virtual threads for high-throughput I/O; keep transaction boundaries explicit.",
    recommendedLibraries: ["java.math.BigDecimal", "java.time", "JUnit 5", "AssertJ"],
    riskFocus: [
      "BigDecimal scale and rounding",
      "Checked exception translation",
      "Transaction boundaries",
      "Thread safety / shared mutable state",
    ],
    notes:
      "Core banking, enterprise services, payments. Preserve double-entry and audit/transaction semantics.",
  },
  {
    id: "csharp-dotnet",
    label: "C# / .NET",
    language: "C#",
    version: ".NET 8",
    extension: ".cs",
    commentPrefix: "//",
    status: "active_experimental",
    codegenSupported: true,
    testFramework: "xUnit",
    styleGuide: "Microsoft C# conventions with nullable reference types enabled.",
    typeSystem:
      "Nullable reference types, records for immutable values, explicit domain types for identifiers and money.",
    numericPolicy:
      "Use decimal for financial values with an explicit MidpointRounding - never double for balances or reconciliation.",
    datePolicy:
      "Use DateOnly, TimeOnly, or DateTimeOffset where boundary precision matters.",
    asyncModel:
      "async/await for I/O and Task-based APIs; keep blocking calls out of request paths.",
    recommendedLibraries: ["System.Decimal", "System.DateTimeOffset", "xUnit", "FluentAssertions"],
    riskFocus: [
      "Nullable reference handling",
      "Decimal rounding",
      "Entity Framework transaction behavior",
      "Async deadlocks from sync-over-async",
    ],
    notes:
      "Microsoft-heavy workflows, line-of-business apps, Azure services. Model approval/audit state as first-class data.",
  },
  {
    id: "cpp-23",
    label: "C++23",
    language: "C++",
    version: "23",
    extension: ".cpp",
    commentPrefix: "//",
    status: "active_experimental",
    codegenSupported: true,
    testFramework: "GoogleTest",
    styleGuide: "C++ Core Guidelines - RAII, narrow interfaces, explicit ownership.",
    typeSystem:
      "Value types, spans/views for non-owning access, smart pointers for ownership, templates only where they reduce duplication safely.",
    numericPolicy:
      "Use fixed-point, decimal, or a vetted quant library for money - avoid binary floating-point drift in settlement-sensitive logic.",
    datePolicy:
      "Use <chrono> with explicit calendars and time-zone assumptions; document exchange calendars and cut-offs.",
    asyncModel:
      "Explicit thread pools, event loops, or low-latency messaging; avoid hidden shared state.",
    recommendedLibraries: ["<chrono>", "GoogleTest", "Catch2", "fmt"],
    riskFocus: [
      "Integer overflow",
      "Object lifetime",
      "Floating-point drift",
      "Data races and lock contention",
    ],
    notes:
      "Low-latency trading, pricing, risk engines. Separate pure pricing/risk functions from I/O adapters.",
  },
  {
    id: "rust-2024",
    label: "Rust 2024",
    language: "Rust",
    version: "2024 edition",
    extension: ".rs",
    commentPrefix: "//",
    status: "active_experimental",
    codegenSupported: true,
    testFramework: "cargo test",
    styleGuide: "Rust API guidelines; clippy and rustfmt clean.",
    typeSystem:
      "Enums for constrained states, Result for recoverable failures, newtypes for domain identifiers and units.",
    numericPolicy:
      "Use rust_decimal or a fixed-point domain type for money; keep overflow behavior explicit (checked / saturating / wrapping).",
    datePolicy:
      "Use chrono or time with explicit timezone and parsing policy; avoid implicit local-time assumptions.",
    asyncModel:
      "Async runtimes such as Tokio where I/O concurrency is required; keep business-rule code sync and pure when possible.",
    recommendedLibraries: ["rust_decimal", "chrono", "tokio", "proptest"],
    riskFocus: [
      "Ownership boundaries",
      "Error propagation",
      "Overflow policy",
      "Async runtime boundaries",
    ],
    notes:
      "Safe high-performance modernization. Model invalid states out of the domain; prefer Result over panics.",
  },
  {
    id: "sql-plsql",
    label: "SQL / PL-SQL",
    language: "SQL",
    version: "PL/SQL · T-SQL",
    extension: ".sql",
    commentPrefix: "--",
    status: "active_experimental",
    codegenSupported: true,
    testFramework: "tSQLt / utPLSQL",
    styleGuide:
      "Dialect-specific SQL style with named transactions and reviewable stored-procedure boundaries.",
    typeSystem:
      "Constrained columns, lookup tables, and checked parameters rather than unstructured strings.",
    numericPolicy:
      "Use DECIMAL / NUMERIC with explicit precision, scale, and rounding; avoid implicit casts that alter settlement values.",
    datePolicy:
      "Use database-native date/timestamp types with timezone and session settings documented per dialect.",
    asyncModel:
      "Rely on transaction isolation, locks, queues, and batch windows; keep concurrency assumptions in procedure contracts.",
    recommendedLibraries: ["utPLSQL", "tSQLt", "sqlparse"],
    riskFocus: [
      "Transaction isolation",
      "Implicit conversion",
      "Procedure side effects",
      "Audit-trail completeness",
    ],
    notes:
      "Stored procedures, reconciliation, settlement. Make transaction scopes explicit; preserve audit checkpoints.",
  },
  {
    id: "go-1x",
    label: "Go",
    language: "Go",
    version: "1.22",
    extension: ".go",
    commentPrefix: "//",
    status: "active_experimental",
    codegenSupported: true,
    testFramework: "go test",
    styleGuide: "Effective Go / gofmt; return errors explicitly and wrap with %w.",
    typeSystem:
      "Small interfaces, explicit structs, typed errors; avoid interface{}/any for domain data.",
    numericPolicy:
      "Use shopspring/decimal (or integer minor units) for money - never float64 for financial values.",
    datePolicy:
      "Use time.Time with explicit locations; avoid implicit local-time assumptions.",
    asyncModel:
      "Goroutines and channels for concurrency; guard shared state with sync primitives or context.",
    recommendedLibraries: ["shopspring/decimal", "time", "testing", "testify"],
    riskFocus: [
      "float64 used for money",
      "Nil pointer / interface handling",
      "Goroutine leaks",
      "Error wrapping and propagation",
    ],
    notes: "Modern services and tooling. Keep business rules in pure functions; isolate I/O behind interfaces.",
  },
  {
    id: "typescript-5x",
    label: "TypeScript",
    language: "TypeScript",
    version: "5.x",
    extension: ".ts",
    commentPrefix: "//",
    status: "active_experimental",
    codegenSupported: true,
    testFramework: "vitest",
    styleGuide: "ESLint + Prettier; exhaustive switch over discriminated unions.",
    typeSystem:
      "strict tsconfig; discriminated unions for states, branded types for identifiers and money, no any.",
    numericPolicy:
      "Use decimal.js (or bigint minor units) for money - never the JS number type for financial values.",
    datePolicy:
      "Use a typed date library (Temporal or date-fns) with explicit time zones; avoid ambiguous Date parsing.",
    asyncModel: "async/await with typed Promises; never leave promises floating.",
    recommendedLibraries: ["decimal.js", "zod", "vitest", "date-fns"],
    riskFocus: [
      "number type used for money",
      "Floating promises",
      "any leaks",
      "Timezone-ambiguous Date parsing",
    ],
    notes: "Web/service modernization. Keep pure business rules separate from framework/IO code.",
  },
];

export const DEFAULT_TARGET_ID = "python-3x";

const _BY_ID = new Map(TARGET_LANGUAGES.map((t) => [t.id, t]));

/** Resolve a catalog entry by id, falling back to the default (Python). */
export function getTargetLanguage(id: string | undefined | null): TargetLanguage {
  return (id && _BY_ID.get(id)) || _BY_ID.get(DEFAULT_TARGET_ID)!;
}

/** Build the snake_case profile payload the /llm/* prompts consume. */
export function toProfileCtx(t: TargetLanguage): TargetProfilePayload {
  return {
    language: t.language,
    version: t.version,
    test_framework: t.testFramework,
    notes: t.notes,
    numeric_policy: t.numericPolicy,
    date_policy: t.datePolicy,
    style_guide: t.styleGuide,
    type_system: t.typeSystem,
    async_model: t.asyncModel,
    recommended_libraries: t.recommendedLibraries,
    risk_focus: t.riskFocus,
  };
}
