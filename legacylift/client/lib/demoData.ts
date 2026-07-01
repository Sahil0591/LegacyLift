// lib/demoData.ts — Seed data for the demo workbench.
// Lets /project/demo-* render a fully populated, navigable pipeline without a
// backend. A COBOL loan engine (acme-bank/loan-engine) migrated to Python 3.12.

import type {
  BusinessRule,
  DependencyGraph,
  MigrationChunk,
  PipelineLayer,
  PipelineState,
  TargetProfile,
} from "@/types/legacylift";

export const DEMO_PROJECT_ID = "demo-loan-engine";
export const DEMO_REPO = "github.com/acme-bank/loan-engine";

export function isDemoProject(projectId: string | null): boolean {
  return !!projectId && projectId.startsWith("demo");
}

// ── Business rules ───────────────────────────────────────────────────────────

const RULES: BusinessRule[] = [
  {
    id: "rule-interest",
    title: "Daily interest accrual",
    description:
      "Interest accrues daily as principal × (APR / 365) × days, rounded half-up to the penny and capped at the per-period maximum.",
    source_file: "interest.cbl",
    source_lines: [128, 156],
    confidence: "High",
    hardcoded_values: ["365", "WS-MAX-INT"],
    warnings: ["Uses a 365-day year — leap years are not handled."],
    status: "Pending",
    ownership_category: "Finance",
    ownership_evidence: "Last changed in PR #142 by the Finance platform team.",
    ownership_confidence: "High",
    ownership_detail: null,
  },
  {
    id: "rule-latefee",
    title: "Late-payment fee cap",
    description:
      "A late fee of 15% of the overdue amount is applied, capped at £25.00 per the 2019 regulatory limit.",
    source_file: "fees.cbl",
    source_lines: [88, 140],
    confidence: "High",
    hardcoded_values: ["0.15", "25.00"],
    warnings: ["Regulatory cap of £25.00 is hardcoded — confirm it is current."],
    status: "Pending",
    ownership_category: "Compliance",
    ownership_evidence: "Decided in PR #142 — 'regulatory cap, 2019'.",
    ownership_confidence: "High",
    ownership_detail: null,
  },
  {
    id: "rule-rate",
    title: "Tiered rate lookup",
    description:
      "APR is selected from the RATE-TABLE copybook based on the customer's credit tier and product code.",
    source_file: "rates.cbl",
    source_lines: [40, 75],
    confidence: "Medium",
    hardcoded_values: [],
    warnings: ["Reads external config — RATE-TABLE values change quarterly."],
    status: "Confirmed",
    ownership_category: "Product",
    ownership_evidence: "Owned by the Lending Product team.",
    ownership_confidence: "Medium",
    ownership_detail: null,
  },
  {
    id: "rule-ledger",
    title: "Double-entry ledger posting",
    description:
      "Every settled transaction posts a balanced debit/credit pair to the general ledger and writes an audit record.",
    source_file: "ledger.cbl",
    source_lines: [210, 288],
    confidence: "High",
    hardcoded_values: [],
    warnings: ["14 callers — highest fan-in in the codebase. Migrate last."],
    status: "Pending",
    ownership_category: "Risk",
    ownership_evidence: "Core ledger owned by the Risk & Controls team.",
    ownership_confidence: "High",
    ownership_detail: null,
  },
  {
    id: "rule-round",
    title: "Banker's rounding on settlement",
    description:
      "Final settlement amounts use ROUND-HALF-UP to two decimal places to match the legacy COMPUTE … ROUNDED behaviour.",
    source_file: "settle.cbl",
    source_lines: [12, 30],
    confidence: "Medium",
    hardcoded_values: ["0.01"],
    warnings: [],
    status: "Pending",
    ownership_category: "Finance",
    ownership_evidence: "Shared finance utility.",
    ownership_confidence: "Medium",
    ownership_detail: null,
  },
  {
    id: "rule-date",
    title: "Date formatting (DDMMYY)",
    description:
      "Dates are formatted as DDMMYY for statement output. Pure function with no side effects.",
    source_file: "dates.cbl",
    source_lines: [5, 22],
    confidence: "High",
    hardcoded_values: [],
    warnings: [],
    status: "Confirmed",
    ownership_category: "Engineering",
    ownership_evidence: "Generic utility paragraph.",
    ownership_confidence: "High",
    ownership_detail: null,
  },
];

// ── Dependency graph ─────────────────────────────────────────────────────────

const GRAPH: DependencyGraph = {
  nodes: [
    { id: "INTEREST-CALC", label: "INTEREST-CALC", file: "interest.cbl", type: "section" },
    { id: "APPLY-LATE-FEE", label: "APPLY-LATE-FEE", file: "fees.cbl", type: "section" },
    { id: "GET-RATE", label: "GET-RATE", file: "rates.cbl", type: "paragraph" },
    { id: "POST-LEDGER", label: "POST-LEDGER", file: "ledger.cbl", type: "paragraph" },
    { id: "RATE-TABLE", label: "RATE-TABLE", file: "rates.cpy", type: "copybook" },
    { id: "FORMAT-DATE", label: "FORMAT-DATE", file: "dates.cbl", type: "paragraph" },
    { id: "DB2-AUDIT", label: "DB2-AUDIT", file: "external", type: "external" },
  ],
  edges: [
    { source: "INTEREST-CALC", target: "GET-RATE", label: "rate" },
    { source: "INTEREST-CALC", target: "POST-LEDGER" },
    { source: "APPLY-LATE-FEE", target: "POST-LEDGER" },
    { source: "GET-RATE", target: "RATE-TABLE" },
    { source: "POST-LEDGER", target: "DB2-AUDIT", label: "audit" },
    { source: "APPLY-LATE-FEE", target: "FORMAT-DATE" },
    { source: "GET-RATE", target: "FORMAT-DATE" },
  ],
};

// ── Risk scores (0–1) ────────────────────────────────────────────────────────

const RISK_SCORES: Record<string, number> = {
  "APPLY-LATE-FEE": 0.86,
  "POST-LEDGER": 0.74,
  "INTEREST-CALC": 0.67,
  "GET-RATE": 0.41,
  "ROUND-HALF-UP": 0.36,
  "FORMAT-DATE": 0.12,
};

// ── Target profile ───────────────────────────────────────────────────────────

const TARGET_PROFILE: TargetProfile = {
  language: "Python",
  version: "3.12",
  recommended_libraries: [],
  deprecated_patterns: [],
  gotchas: [],
  style_guide: "PEP 8 · formatted with Black",
  type_system: "Full type hints · mypy --strict",
  async_model: "Synchronous (nightly batch jobs)",
  test_framework: "pytest",
  notes: "All monetary math uses decimal.Decimal — never float.",
};

// ── Chunks ───────────────────────────────────────────────────────────────────

function chunk(
  partial: Pick<MigrationChunk, "id" | "name" | "risk_level" | "status"> &
    Partial<MigrationChunk>,
): MigrationChunk {
  return {
    source_code: "",
    migrated_code: "",
    diff: "",
    retry_count: 0,
    test_results: [],
    static_analysis: null,
    ai_review: null,
    ...partial,
  };
}

const INTEREST_SOURCE = `       INTEREST-CALC SECTION.
           COMPUTE WS-DAILY-RATE = WS-APR / 365.
           COMPUTE WS-INTEREST ROUNDED =
               WS-PRINCIPAL * WS-DAILY-RATE * WS-DAYS.
           IF WS-INTEREST > WS-MAX-INT
               MOVE WS-MAX-INT TO WS-INTEREST
           END-IF.
           ADD WS-INTEREST TO WS-BALANCE.
       INTEREST-CALC-EXIT.
           EXIT.`;

const INTEREST_TARGET = `def interest_calc(principal: Decimal, apr: Decimal, days: int) -> Decimal:
    """Daily interest accrual — see business rule rule-interest."""
    daily_rate = apr / Decimal(365)
    interest = (principal * daily_rate * days).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return min(interest, MAX_INTEREST)`;

const CHUNKS: MigrationChunk[] = [
  chunk({
    id: "chunk-01",
    name: "FORMAT-DATE",
    risk_level: "Low",
    status: "Approved",
    source_code: "       FORMAT-DATE.\n           STRING WS-DD WS-MM WS-YY INTO WS-OUT.",
    migrated_code:
      'def format_date(d: date) -> str:\n    return d.strftime("%d%m%y")',
  }),
  chunk({
    id: "chunk-02",
    name: "GET-RATE",
    risk_level: "Medium",
    status: "Approved",
    source_code:
      "       GET-RATE.\n           SEARCH ALL RATE-TABLE\n               WHEN RT-TIER = WS-TIER\n               MOVE RT-APR TO WS-APR.",
    migrated_code:
      "def get_rate(tier: str) -> Decimal:\n    return RATE_TABLE[tier].apr",
  }),
  chunk({
    id: "chunk-03",
    name: "INTEREST-CALC",
    risk_level: "High",
    status: "Review",
    source_code: INTEREST_SOURCE,
    migrated_code: INTEREST_TARGET,
    static_analysis: {
      passed: true,
      issues: [],
      complexity_score: 7,
      line_count: 24,
    },
    ai_review: {
      issues_found: 1,
      critical_issues: [],
      warnings: ["Confirm ROUND_HALF_UP matches the legacy COMPUTE … ROUNDED."],
      suggestions: ["Add a property test covering the WS-MAX-INT cap."],
      ai_confidence: "High",
      raw_response: "",
    },
    test_results: [
      { name: "test_interest_basic", passed: true, error_message: null, duration_ms: 4 },
      { name: "test_interest_caps_at_max", passed: true, error_message: null, duration_ms: 3 },
      { name: "test_interest_zero_days", passed: true, error_message: null, duration_ms: 2 },
    ],
  }),
  chunk({
    id: "chunk-04",
    name: "POST-LEDGER",
    risk_level: "High",
    status: "Pending",
    source_code:
      "       POST-LEDGER.\n           WRITE LEDGER-DEBIT FROM WS-TXN.\n           WRITE LEDGER-CREDIT FROM WS-TXN.\n           PERFORM DB2-AUDIT.",
    migrated_code:
      "def post_ledger(txn: Transaction) -> None:\n    ledger.write(txn.as_debit())\n    ledger.write(txn.as_credit())\n    audit.record(txn)",
  }),
  chunk({
    id: "chunk-05",
    name: "APPLY-LATE-FEE",
    risk_level: "Critical",
    status: "Pending",
    source_code:
      "       APPLY-LATE-FEE.\n           COMPUTE WS-FEE = WS-OVERDUE * 0.15.\n           IF WS-FEE > 25.00\n               MOVE 25.00 TO WS-FEE\n           END-IF.",
    migrated_code:
      'def apply_late_fee(overdue: Decimal) -> Decimal:\n    fee = (overdue * Decimal("0.15")).quantize(Decimal("0.01"))\n    return min(fee, LATE_FEE_CAP)',
  }),
];

const CURRENT = CHUNKS.find((c) => c.status === "Review") ?? null;

// ── Public factory ───────────────────────────────────────────────────────────

export function createDemoState(
  projectId: string,
  currentLayer: PipelineLayer = 0,
): PipelineState {
  return {
    projectId,
    currentLayer,
    businessRules: RULES.map((r) => ({ ...r })),
    dependencyGraph: { nodes: [...GRAPH.nodes], edges: [...GRAPH.edges] },
    riskScores: { ...RISK_SCORES },
    targetProfile: { ...TARGET_PROFILE },
    currentChunk: CURRENT ? { ...CURRENT } : null,
    chunks: CHUNKS.map((c) => ({ ...c })),
    migrationComplete: false,
    error: null,
  };
}
