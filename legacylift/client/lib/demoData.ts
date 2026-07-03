// lib/demoData.ts — Seed data for the demo workbench.
// Lets /project/demo-* render a fully populated, navigable pipeline without a
// backend. A COBOL loan engine (acme-bank/loan-engine) migrated to Python 3.12.

import type {
  BusinessRule,
  DependencyGraph,
  MigrationChunk,
  PipelineLayer,
  PipelineState,
  ProjectFile,
  TargetProfile,
} from "@/types/legacylift";
import type { ProjectConfig } from "@/lib/projectConfig";

export const DEMO_PROJECT_ID = "demo-loan-engine";
export const DEMO_REPO = "github.com/acme-bank/loan-engine";
export const DEMO_HERITAGE_PROJECT_ID = "demo-heritage-payments";
export const DEMO_HERITAGE_REPO = "github.com/acme-bank/heritage-payments";

export function isDemoProject(projectId: string | null): boolean {
  return !!projectId && projectId.startsWith("demo");
}

export function getDemoRepo(projectId: string | null): string {
  return projectId === DEMO_HERITAGE_PROJECT_ID ? DEMO_HERITAGE_REPO : DEMO_REPO;
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
    source_file: "",
    start_line: 0,
    end_line: 0,
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
    source_file: "dates.cbl",
    start_line: 5,
    end_line: 22,
    source_code: "       FORMAT-DATE.\n           STRING WS-DD WS-MM WS-YY INTO WS-OUT.",
    migrated_code:
      'def format_date(d: date) -> str:\n    return d.strftime("%d%m%y")',
  }),
  chunk({
    id: "chunk-02",
    name: "GET-RATE",
    risk_level: "Medium",
    status: "Approved",
    source_file: "rates.cbl",
    start_line: 40,
    end_line: 75,
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
    source_file: "interest.cbl",
    start_line: 128,
    end_line: 156,
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
    source_file: "ledger.cbl",
    start_line: 210,
    end_line: 288,
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
    source_file: "fees.cbl",
    start_line: 88,
    end_line: 140,
    source_code:
      "       APPLY-LATE-FEE.\n           COMPUTE WS-FEE = WS-OVERDUE * 0.15.\n           IF WS-FEE > 25.00\n               MOVE 25.00 TO WS-FEE\n           END-IF.",
    migrated_code:
      'def apply_late_fee(overdue: Decimal) -> Decimal:\n    fee = (overdue * Decimal("0.15")).quantize(Decimal("0.01"))\n    return min(fee, LATE_FEE_CAP)',
  }),
];

const CURRENT = CHUNKS.find((c) => c.status === "Review") ?? null;

// Reconstruct a "full file" view per source file from its chunks' original
// source, in line order — just enough for the file-context panel to show
// something coherent; not meant to be authentic re-parsed COBOL/Java.
function buildDemoFiles(chunks: MigrationChunk[], language: string): ProjectFile[] {
  const byFile = new Map<string, MigrationChunk[]>();
  for (const c of chunks) {
    if (!c.source_file) continue;
    const list = byFile.get(c.source_file) ?? [];
    list.push(c);
    byFile.set(c.source_file, list);
  }
  return [...byFile.entries()].map(([filename, fileChunks]) => {
    const ordered = [...fileChunks].sort((a, b) => a.start_line - b.start_line);
    const content = ordered.map((c) => c.source_code).join("\n\n");
    return { filename, content, language };
  });
}

const FILES: ProjectFile[] = buildDemoFiles(CHUNKS, "COBOL");

const JAVA_RULES: BusinessRule[] = [
  {
    id: "java-rule-account-status",
    title: "Account status gate",
    description:
      "Every posting path rejects Suspended and Closed accounts before balance or ledger mutation.",
    source_file: "AccountService.java",
    source_lines: [29, 98],
    confidence: "High",
    hardcoded_values: ["ACTIVE", "SUSPENDED", "CLOSED"],
    warnings: ["Status literals are embedded in service code."],
    status: "Pending",
    ownership_category: "Ops",
    ownership_evidence: "Operational account controls owned by payments operations.",
    ownership_confidence: "High",
    ownership_detail: null,
  },
  {
    id: "java-rule-daily-limit",
    title: "Daily customer transfer limit",
    description:
      "Transfer amount plus used daily amount must not exceed DAILY_LIMIT before any funds movement.",
    source_file: "FundsTransferProcessor.java",
    source_lines: [128, 160],
    confidence: "High",
    hardcoded_values: [],
    warnings: ["Uses row locking and mutable USED_AMOUNT counters."],
    status: "Pending",
    ownership_category: "Risk",
    ownership_evidence: "Customer exposure limits map to risk controls.",
    ownership_confidence: "High",
    ownership_detail: null,
  },
  {
    id: "java-rule-routing",
    title: "Internal versus external routing",
    description:
      "Same-bank transfers post debit and credit directly; external transfers credit a settlement suspense account for EOD clearing.",
    source_file: "FundsTransferProcessor.java",
    source_lines: [59, 82],
    confidence: "High",
    hardcoded_values: ["25000.00", "10000.00", "9"],
    warnings: ["External routing number validation is length-only."],
    status: "Pending",
    ownership_category: "Product",
    ownership_evidence: "Payment rail behavior owned by payments product.",
    ownership_confidence: "Medium",
    ownership_detail: null,
  },
  {
    id: "java-rule-overdraft-cap",
    title: "Overdraft fee cap",
    description:
      "Overdraft fees are percentage based, bounded by minimum and maximum fees, and further capped at a daily regulatory ceiling.",
    source_file: "OverdraftFeeCalculator.java",
    source_lines: [14, 49],
    confidence: "High",
    hardcoded_values: ["0.035", "5.00", "35.00", "50.00"],
    warnings: ["Regulatory cap is compiled into Java constants."],
    status: "Pending",
    ownership_category: "Compliance",
    ownership_evidence: "Fee caps fall under compliance approval.",
    ownership_confidence: "High",
    ownership_detail: null,
  },
  {
    id: "java-rule-eod",
    title: "EOD settlement audit",
    description:
      "External network settlement posts suspense double-entry rows and writes SETTLEMENT_AUDIT only after totals are complete.",
    source_file: "EndOfDaySettlementJob.java",
    source_lines: [25, 66],
    confidence: "High",
    hardcoded_values: ["POSTED", "COMPLETE", "FAILED"],
    warnings: ["Failure audit is best-effort after rollback."],
    status: "Pending",
    ownership_category: "Finance",
    ownership_evidence: "Settlement totals feed finance reconciliation.",
    ownership_confidence: "High",
    ownership_detail: null,
  },
];

const JAVA_GRAPH: DependencyGraph = {
  nodes: [
    { id: "processTransfer", label: "processTransfer", file: "FundsTransferProcessor.java", type: "paragraph" },
    { id: "getAvailableBalance", label: "getAvailableBalance", file: "AccountService.java", type: "paragraph" },
    { id: "applyBalanceChange", label: "applyBalanceChange", file: "AccountService.java", type: "paragraph" },
    { id: "postDoubleEntry", label: "postDoubleEntry", file: "LedgerPostingDao.java", type: "paragraph" },
    { id: "calculateFee", label: "calculateFee", file: "OverdraftFeeCalculator.java", type: "paragraph" },
    { id: "runSettlement", label: "runSettlement", file: "EndOfDaySettlementJob.java", type: "paragraph" },
    { id: "legacy_java_bank.sql", label: "legacy_java_bank.sql", file: "sample_schema", type: "external" },
  ],
  edges: [
    { source: "processTransfer", target: "getAvailableBalance" },
    { source: "processTransfer", target: "applyBalanceChange" },
    { source: "processTransfer", target: "postDoubleEntry" },
    { source: "processTransfer", target: "calculateFee", label: "overdraft" },
    { source: "runSettlement", target: "postDoubleEntry", label: "EOD" },
    { source: "processTransfer", target: "legacy_java_bank.sql", label: "JDBC" },
    { source: "runSettlement", target: "legacy_java_bank.sql", label: "JDBC" },
  ],
};

const JAVA_RISK_SCORES: Record<string, number> = {
  processTransfer: 0.93,
  runSettlement: 0.81,
  postDoubleEntry: 0.78,
  calculateFee: 0.69,
  applyBalanceChange: 0.62,
  getAvailableBalance: 0.44,
};

const JAVA_TARGET_PROFILE: TargetProfile = {
  language: "Java",
  version: "21 / Spring Boot 3",
  recommended_libraries: [],
  deprecated_patterns: [],
  gotchas: [],
  style_guide: "Spring service boundaries, constructor injection, transaction annotations",
  type_system: "Strong Java types with BigDecimal preserved for monetary values",
  async_model: "Synchronous APIs with scheduled settlement jobs",
  test_framework: "JUnit 5",
  notes: "Preserve double-entry ledger invariants and explicit settlement audit semantics.",
};

const JAVA_PROCESS_TRANSFER_SOURCE = `public void processTransfer(Connection connection, long transferRequestId)
        throws SQLException {
    boolean originalAutoCommit = connection.getAutoCommit();
    connection.setAutoCommit(false);
    try {
        TransferRequest request = loadTransferRequest(connection, transferRequestId);
        assertDailyLimitAvailable(connection, request.customerId, request.amount);
        BigDecimal currentBalance = accountService.getAvailableBalance(connection, request.debitAccountId);
        BigDecimal projectedBalance = currentBalance.subtract(request.amount);
        if (isFraudHoldRequired(connection, request, projectedBalance)) {
            createRiskHold(connection, request, "FRAUD_REVIEW_THRESHOLD");
            updateTransferStatus(connection, transferRequestId, TRANSFER_STATUS_HELD);
            connection.commit();
            return;
        }
        connection.commit();
    } catch (SQLException ex) {
        connection.rollback();
        throw ex;
    } finally {
        connection.setAutoCommit(originalAutoCommit);
    }
}`;

const JAVA_CHUNKS: MigrationChunk[] = [
  chunk({
    id: "java-chunk-01",
    name: "processTransfer",
    risk_level: "Critical",
    status: "Review",
    source_file: "FundsTransferProcessor.java",
    start_line: 20,
    end_line: 160,
    source_code: JAVA_PROCESS_TRANSFER_SOURCE,
    migrated_code:
      "@Transactional\npublic void processTransfer(long transferRequestId) {\n    TransferRequest request = transferRepository.lockById(transferRequestId);\n    dailyLimitService.assertAvailable(request.customerId(), request.amount());\n    riskHoldService.placeHoldWhenRequired(request);\n    ledgerService.postTransfer(request);\n}",
    static_analysis: {
      passed: true,
      issues: [],
      complexity_score: 14,
      line_count: 118,
    },
    ai_review: {
      issues_found: 2,
      critical_issues: [],
      warnings: [
        "Confirm rollback behavior for rejected transfer status updates.",
        "External suspense posting must remain balanced."
      ],
      suggestions: ["Add transaction tests for held, posted, and rejected transfers."],
      ai_confidence: "High",
      raw_response: "",
    },
    test_results: [
      { name: "processTransfer_holdsHighRiskPayment", passed: true, error_message: null, duration_ms: 7 },
      { name: "processTransfer_rejectsDailyLimitBreach", passed: true, error_message: null, duration_ms: 6 },
    ],
  }),
  chunk({
    id: "java-chunk-02",
    name: "calculateFee",
    risk_level: "High",
    status: "Pending",
    source_file: "OverdraftFeeCalculator.java",
    start_line: 14,
    end_line: 49,
    source_code:
      'BigDecimal proposedFee = overdrawnAmount.multiply(OVERDRAFT_FEE_RATE);\nproposedFee = proposedFee.setScale(2, RoundingMode.HALF_UP);\nif (proposedFee.compareTo(MAXIMUM_FEE) > 0) {\n    proposedFee = MAXIMUM_FEE;\n}',
    migrated_code:
      'BigDecimal fee = overdraftPolicy.calculate(balanceAfterDebit, feesAlreadyAssessedToday);',
  }),
  chunk({
    id: "java-chunk-03",
    name: "postDoubleEntry",
    risk_level: "High",
    status: "Pending",
    source_file: "LedgerPostingDao.java",
    start_line: 10,
    end_line: 40,
    source_code:
      'insertLedgerEntry(connection, transferRequestId, debitAccountId, ENTRY_TYPE_DEBIT, amount, narrative);\ninsertLedgerEntry(connection, transferRequestId, creditAccountId, ENTRY_TYPE_CREDIT, amount, narrative);',
    migrated_code:
      "ledgerRepository.saveAll(List.of(debitEntry, creditEntry));",
  }),
  chunk({
    id: "java-chunk-04",
    name: "runSettlement",
    risk_level: "High",
    status: "Pending",
    source_file: "EndOfDaySettlementJob.java",
    start_line: 25,
    end_line: 66,
    source_code:
      "while (resultSet.next()) {\n    ledgerPostingDao.postDoubleEntry(connection, transferRequestId, suspenseAccountId, debitAccountId, amount, \"EOD external network settlement\");\n    settledCount++;\n}",
    migrated_code:
      "settlementRepository.findPostedExternalTransfers(businessDate).forEach(this::settleExternalTransfer);",
  }),
];

const JAVA_CURRENT = JAVA_CHUNKS.find((c) => c.status === "Review") ?? null;

const JAVA_FILES: ProjectFile[] = buildDemoFiles(JAVA_CHUNKS, "Java");

// ── Public factory ───────────────────────────────────────────────────────────

export function createDemoState(
  projectId: string,
  currentLayer: PipelineLayer = 0,
): PipelineState {
  if (projectId === DEMO_HERITAGE_PROJECT_ID) {
    return {
      projectId,
      currentLayer,
      businessRules: JAVA_RULES.map((r) => ({ ...r })),
      dependencyGraph: { nodes: [...JAVA_GRAPH.nodes], edges: [...JAVA_GRAPH.edges] },
      riskScores: { ...JAVA_RISK_SCORES },
      targetProfile: { ...JAVA_TARGET_PROFILE },
      currentChunk: JAVA_CURRENT ? { ...JAVA_CURRENT } : null,
      chunks: JAVA_CHUNKS.map((c) => ({ ...c })),
      files: JAVA_FILES.map((f) => ({ ...f })),
      migrationComplete: false,
      error: null,
    };
  }

  return {
    projectId,
    currentLayer,
    businessRules: RULES.map((r) => ({ ...r })),
    dependencyGraph: { nodes: [...GRAPH.nodes], edges: [...GRAPH.edges] },
    riskScores: { ...RISK_SCORES },
    targetProfile: { ...TARGET_PROFILE },
    currentChunk: CURRENT ? { ...CURRENT } : null,
    chunks: CHUNKS.map((c) => ({ ...c })),
    files: FILES.map((f) => ({ ...f })),
    migrationComplete: false,
    error: null,
  };
}

// Seed workbench config for the demos so both new features are visible out of
// the box: sample institutional context, and a genuinely mixed-target project
// (the COBOL loan engine defaults to Python but sends ledger.cbl to Java).
export function getDemoConfig(projectId: string): ProjectConfig {
  if (projectId === DEMO_HERITAGE_PROJECT_ID) {
    return {
      context: {
        global:
          "Acme Bank core payments. Money is GBP in minor units (pence). Preserve the double-entry ledger invariants and the end-of-day settlement audit exactly. External transfers must route through the settlement suspense account for EOD clearing.",
        perFile: {},
      },
      targets: { default: "java-21", perFile: {} },
    };
  }
  return {
    context: {
      global:
        "Acme Bank loan engine. COMP-3 money fields are GBP pence. The £25.00 late-fee cap is a 2019 FCA regulatory limit — never change it. RATE-TABLE is sourced from our quarterly regulatory feed; treat its values as external config, not constants to inline.",
      perFile: {
        "ledger.cbl":
          "The general ledger posts to the DB2 GLEDGER table via a copybook we cannot change. Keep the debit-before-credit ordering and the audit write. This module is consumed by our Java services — migrate it to Java.",
      },
    },
    targets: { default: "python-3x", perFile: { "ledger.cbl": "java-21" } },
  };
}
