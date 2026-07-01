// lib/analyze.ts — Deterministic, rule-based analysis of uploaded legacy code.
// Runs server-side (in /api/analyze). No LLM, no hardcoded per-file scores:
// every risk tier comes from explicit signals so it's auditable.
//
// Pipeline: split source into units → score each unit with risk RULES →
// infer call dependencies → derive lightweight business rules → assemble a
// PipelineState-shaped result the workbench can load directly.

import type {
  BusinessRule,
  DependencyGraph,
  DependencyNode,
  MigrationChunk,
  OwnershipCategory,
  RiskLevel,
  RuleConfidence,
  TargetProfile,
} from "@/types/legacylift";

export interface InputFile {
  filename: string;
  content: string;
}

export interface AnalyzeResult {
  projectName: string;
  source: string; // "upload" | "github:owner/repo"
  chunks: MigrationChunk[];
  businessRules: BusinessRule[];
  dependencyGraph: DependencyGraph;
  riskScores: Record<string, number>;
  targetProfile: TargetProfile;
  summary: {
    files: number;
    units: number;
    avgRisk: number;
    byLevel: Record<RiskLevel, number>;
  };
}

// Caps so a huge repo can't blow up the response / the UI.
const MAX_UNITS = 80;

// ─────────────────────────────────────────────────────────────────────────────
// Language + unit splitting
// ─────────────────────────────────────────────────────────────────────────────

interface CodeUnit {
  id: string;
  name: string;
  file: string;
  language: "cobol" | "generic";
  source: string;
  startLine: number;
  endLine: number;
  calls: string[];
}

function detectLanguage(filename: string): "cobol" | "generic" {
  return /\.(cbl|cob|cobol|cpy)$/i.test(filename) ? "cobol" : "generic";
}

function slug(file: string, name: string): string {
  const stem = file.replace(/\.[^.]+$/, "").toLowerCase();
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${stem}__${n}`;
}

// Split a COBOL line into its indicator + content, handling fixed format
// (cols 1-6 sequence area, col 7 indicator, cols 8+ code) and free format.
function cobolLine(raw: string): { indicator: string; content: string } {
  if (raw.length >= 7 && /^[\s\d]{6}/.test(raw)) {
    return { indicator: raw[6] ?? " ", content: raw.slice(7) };
  }
  const lead = raw.match(/^\s*/)?.[0].length ?? 0;
  return { indicator: raw[lead] === "*" ? "*" : " ", content: raw };
}

const COBOL_PARA = /^([A-Z0-9][A-Z0-9-]*)\s*\.\s*$/;
const COBOL_SECTION = /^([A-Z0-9][A-Z0-9-]*)\s+SECTION\s*\.\s*$/i;
const NON_PARA = new Set([
  "IDENTIFICATION",
  "ENVIRONMENT",
  "DATA",
  "PROCEDURE",
  "WORKING-STORAGE",
  "LINKAGE",
  "FILE",
  "END",
]);

function splitCobol(file: string, content: string): CodeUnit[] {
  const lines = content.split("\n");
  let inProcedure = false;
  const headers: { name: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const { indicator, content } = cobolLine(lines[i]);
    if (indicator === "*" || indicator === "/") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;

    if (/PROCEDURE\s+DIVISION/i.test(trimmed)) {
      inProcedure = true;
      continue;
    }
    if (!inProcedure) continue;
    // Headers start in Area A — the first content column (col 8) is non-space.
    if (content[0] === " " || content[0] === "\t") continue;

    const sec = trimmed.match(COBOL_SECTION);
    if (sec) {
      headers.push({ name: `${sec[1].toUpperCase()} SECTION`, line: i + 1 });
      continue;
    }
    const para = trimmed.match(COBOL_PARA);
    if (para) {
      const name = para[1].toUpperCase();
      if (!NON_PARA.has(name)) headers.push({ name, line: i + 1 });
    }
  }

  const units: CodeUnit[] = [];
  for (let h = 0; h < headers.length; h++) {
    const start = headers[h].line;
    const end = h + 1 < headers.length ? headers[h + 1].line - 1 : lines.length;
    const src = lines.slice(start - 1, end).join("\n");
    units.push({
      id: slug(file, headers[h].name),
      name: headers[h].name,
      file,
      language: "cobol",
      source: src,
      startLine: start,
      endLine: end,
      calls: extractCalls(src),
    });
  }
  return units;
}

function extractCalls(src: string): string[] {
  const calls: string[] = [];
  const perform = /\bPERFORM\s+([A-Z0-9][A-Z0-9-]+)/gi;
  const call = /\bCALL\s+['"]([^'"]+)['"]/gi;
  const goto = /\bGO\s+TO\s+([A-Z0-9][A-Z0-9-]+)/gi;
  const skip = new Set(["UNTIL", "VARYING", "TIMES", "THRU", "THROUGH"]);
  let m: RegExpExecArray | null;
  while ((m = perform.exec(src))) {
    const n = m[1].toUpperCase();
    if (!skip.has(n)) calls.push(n);
  }
  while ((m = call.exec(src))) calls.push(m[1].toUpperCase());
  while ((m = goto.exec(src))) {
    const n = m[1].toUpperCase();
    if (!skip.has(n)) calls.push(n);
  }
  return [...new Set(calls)];
}

function splitFiles(files: InputFile[]): CodeUnit[] {
  const units: CodeUnit[] = [];
  for (const f of files) {
    if (detectLanguage(f.filename) === "cobol") {
      const cobolUnits = splitCobol(f.filename, f.content);
      // If splitting found nothing usable, fall back to whole-file unit.
      if (cobolUnits.length > 0) units.push(...cobolUnits);
      else units.push(wholeFileUnit(f));
    } else {
      units.push(wholeFileUnit(f));
    }
    if (units.length >= MAX_UNITS) break;
  }
  return units.slice(0, MAX_UNITS);
}

function wholeFileUnit(f: InputFile): CodeUnit {
  const name = f.filename.replace(/\.[^.]+$/, "").toUpperCase();
  return {
    id: slug(f.filename, name),
    name,
    file: f.filename,
    language: "generic",
    source: f.content,
    startLine: 1,
    endLine: f.content.split("\n").length,
    calls: extractCalls(f.content),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk RULES — every tier is derived, nothing hardcoded
// ─────────────────────────────────────────────────────────────────────────────

const MONEY_WORDS =
  /\b(INTEREST|RATE|FEE|BALANCE|PAYMENT|LEDGER|AMOUNT|TAX|CURRENCY|PRICE|COST|CHARGE|DEBIT|CREDIT|PENALTY|REFUND|DISCOUNT|SALARY|WAGE|PAYROLL|PRINCIPAL)\b/i;

function magicNumbers(src: string): string[] {
  const found = new Set<string>();
  for (const line of src.split("\n")) {
    if (line.trim().startsWith("*")) continue;
    for (const m of line.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
      // ignore tiny indices like 0/1/2 line noise
      if (m[0].length >= 2 || m[0].includes(".")) found.add(m[0]);
    }
  }
  return [...found].slice(0, 8);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function levelFromScore(score: number): RiskLevel {
  if (score >= 0.8) return "Critical";
  if (score >= 0.6) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}

interface RiskResult {
  score: number;
  level: RiskLevel;
  reasons: string[];
  values: string[];
}

function scoreUnit(unit: CodeUnit, fanIn: number): RiskResult {
  const src = unit.source;
  const reasons: string[] = [];
  let score = 0;

  // Rule 1 — touches money.
  if (MONEY_WORDS.test(src)) {
    score += 0.3;
    reasons.push("Touches money");
  }
  // Rule 2 — packed-decimal precision.
  if (/COMP-3|COMPUTATIONAL-3|PACKED-DECIMAL/i.test(src)) {
    score += 0.18;
    reasons.push("Packed-decimal arithmetic");
  }
  // Rule 3 — non-trivial financial arithmetic.
  if (/\b(COMPUTE|MULTIPLY|DIVIDE)\b/i.test(src)) {
    score += 0.12;
    reasons.push("Computed arithmetic");
  }
  // Rule 4 — blast radius from inbound calls.
  if (fanIn >= 2) {
    score += clamp01(fanIn * 0.08);
    if (fanIn >= 3) reasons.push(`High fan-in (${fanIn} callers)`);
  }
  // Rule 5 — magic numbers.
  const values = magicNumbers(src);
  if (values.length >= 2) {
    score += Math.min(values.length * 0.025, 0.12);
    if (values.length >= 4)
      reasons.push(`${values.length} hardcoded values`);
  }
  // Rule 6 — commented-out / dead code.
  const lines = src.split("\n");
  const dead = lines.filter((l) => l.trim().startsWith("*")).length;
  const deadRatio = lines.length ? dead / lines.length : 0;
  if (deadRatio > 0.12) {
    score += Math.min(deadRatio * 0.3, 0.1);
    reasons.push("Commented-out code present");
  }
  // Rule 7 — external I/O / DB.
  if (/\b(EXEC\s+SQL|CALL|WRITE|READ|REWRITE|DELETE)\b/i.test(src)) {
    score += 0.08;
    reasons.push("External I/O");
  }
  // Rule 8 — size.
  score += Math.min(lines.length / 400, 0.1);

  const final = clamp01(Number(score.toFixed(3)));
  return { score: final, level: levelFromScore(final), reasons, values };
}

// ─────────────────────────────────────────────────────────────────────────────
// Business rules (heuristic) + dependency graph
// ─────────────────────────────────────────────────────────────────────────────

function humanize(name: string): string {
  const base = name.replace(/\s+SECTION$/i, "");
  const words = base.toLowerCase().split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return base;
  return words
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function ownerFor(src: string): OwnershipCategory {
  if (MONEY_WORDS.test(src)) return "Finance";
  if (/EXEC\s+SQL|TABLE|SELECT|INSERT/i.test(src)) return "Risk";
  if (/DATE|TIME|FORMAT/i.test(src)) return "Engineering";
  return "Unknown";
}

function confidenceFor(risk: RiskResult): RuleConfidence {
  if (risk.reasons.includes("Touches money") && risk.values.length >= 2)
    return "High";
  if (risk.reasons.length >= 2) return "Medium";
  return "Low";
}

function nodeType(unit: CodeUnit): DependencyNode["type"] {
  if (unit.language !== "cobol") return "external";
  return unit.name.endsWith("SECTION") ? "section" : "paragraph";
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PROFILE: TargetProfile = {
  language: "Python",
  version: "3.12",
  recommended_libraries: [],
  deprecated_patterns: [],
  gotchas: [],
  style_guide: "PEP 8 · formatted with Black",
  type_system: "Full type hints · mypy --strict",
  async_model: "Synchronous (batch jobs)",
  test_framework: "pytest",
  notes: "All monetary math uses decimal.Decimal — never float.",
};

export function analyzeFiles(
  files: InputFile[],
  meta: { projectName: string; source: string },
): AnalyzeResult {
  const usable = files.filter((f) => f.content && f.content.trim().length > 0);
  const units = splitFiles(usable);

  // Fan-in: how many units call each unit name.
  const byName = new Map<string, CodeUnit>();
  for (const u of units) byName.set(u.name, u);
  const fanIn = new Map<string, number>();
  for (const u of units) {
    for (const c of u.calls) {
      if (byName.has(c)) fanIn.set(c, (fanIn.get(c) ?? 0) + 1);
    }
  }

  const riskScores: Record<string, number> = {};
  const chunks: MigrationChunk[] = [];
  const businessRules: BusinessRule[] = [];
  const byLevel: Record<RiskLevel, number> = {
    Low: 0,
    Medium: 0,
    High: 0,
    Critical: 0,
  };

  units.forEach((unit, i) => {
    const risk = scoreUnit(unit, fanIn.get(unit.name) ?? 0);
    riskScores[unit.name] = risk.score;
    byLevel[risk.level] += 1;

    chunks.push({
      id: unit.id,
      name: unit.name,
      source_code: unit.source,
      migrated_code: "",
      diff: "",
      risk_level: risk.level,
      status: "Pending",
      retry_count: 0,
      test_results: [],
      static_analysis: null,
      ai_review: null,
    });

    // Emit a business rule only when there's a real signal.
    if (risk.reasons.length > 0 && (MONEY_WORDS.test(unit.source) || risk.values.length >= 2)) {
      businessRules.push({
        id: `rule-${unit.id}`,
        title: humanize(unit.name),
        description: `Detected in ${unit.name}: ${risk.reasons.join("; ")}.`,
        source_file: unit.file,
        source_lines: [unit.startLine, unit.endLine],
        confidence: confidenceFor(risk),
        hardcoded_values: risk.values,
        warnings: risk.reasons.includes("Commented-out code present")
          ? ["Commented-out code may hide an older version of this rule."]
          : [],
        status: "Pending",
        ownership_category: ownerFor(unit.source),
        ownership_evidence: "Inferred from static code signals.",
        ownership_confidence: "Low",
        ownership_detail: null,
      });
    }
    void i;
  });

  // Dependency graph from calls between known units.
  const nodes: DependencyNode[] = units.map((u) => ({
    id: u.name,
    label: u.name,
    file: u.file,
    type: nodeType(u),
  }));
  const edges = [];
  for (const u of units) {
    for (const c of u.calls) {
      if (byName.has(c) && c !== u.name) {
        edges.push({ source: u.name, target: c });
      }
    }
  }

  const scoreValues = Object.values(riskScores);
  const avgRisk = scoreValues.length
    ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
    : 0;

  return {
    projectName: meta.projectName,
    source: meta.source,
    chunks,
    businessRules,
    dependencyGraph: { nodes, edges },
    riskScores,
    targetProfile: DEFAULT_PROFILE,
    summary: {
      files: usable.length,
      units: units.length,
      avgRisk: Number(avgRisk.toFixed(3)),
      byLevel,
    },
  };
}
