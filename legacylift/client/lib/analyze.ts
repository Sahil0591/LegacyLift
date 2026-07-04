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
  ProjectFile,
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
  files: ProjectFile[];
  summary: {
    files: number;
    units: number;
    avgRisk: number;
    byLevel: Record<RiskLevel, number>;
    /** Filenames dropped entirely because MAX_UNITS was reached — empty in the common case. */
    filesSkipped: string[];
  };
}

// Caps so a pathologically huge repo can't blow up the response / the UI.
// High enough that a normal multi-file COBOL project (dozens of paragraphs
// per program) never gets anywhere near it in practice.
const MAX_UNITS = 2000;

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

// Case-insensitive char classes so lowercase / free-format COBOL (very common
// in GnuCOBOL repos) is recognised, not only upper-case fixed-format source.
const COBOL_PARA = /^([A-Za-z0-9][A-Za-z0-9-]*)\s*\.\s*$/;
const COBOL_SECTION = /^([A-Za-z0-9][A-Za-z0-9-]*)\s+SECTION\s*\.\s*$/i;

// Division/section keywords and lone statement verbs that match the bare
// "WORD." shape of a paragraph header but are not paragraphs. Names are
// upper-cased before lookup; scope terminators (END-IF. etc.) are excluded
// separately via an "END-" prefix test.
const NON_PARA = new Set([
  "IDENTIFICATION", "ENVIRONMENT", "DATA", "PROCEDURE",
  "WORKING-STORAGE", "LOCAL-STORAGE", "LINKAGE", "FILE",
  "REPORT", "SCREEN", "CONFIGURATION", "INPUT-OUTPUT", "COMMUNICATION",
  "END", "GOBACK", "EXIT", "CONTINUE", "STOP",
]);

// SECTION names that belong to the DATA / ENVIRONMENT divisions — never the
// PROCEDURE division, so they must never become graph nodes.
const NON_PROC_SECTION = new Set([
  "WORKING-STORAGE", "LOCAL-STORAGE", "LINKAGE", "FILE",
  "REPORT", "SCREEN", "CONFIGURATION", "INPUT-OUTPUT", "COMMUNICATION",
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

    // A new program header, or END PROGRAM, leaves the procedure division.
    // Without this reset inProcedure latches on at the first PROCEDURE DIVISION
    // and every later (nested / batched) program's DATA DIVISION sections leak
    // in as bogus "WORKING-STORAGE SECTION" nodes.
    if (
      /^(IDENTIFICATION|ENVIRONMENT|DATA)\s+DIVISION/i.test(trimmed) ||
      /^END\s+PROGRAM\b/i.test(trimmed)
    ) {
      inProcedure = false;
      continue;
    }
    if (/PROCEDURE\s+DIVISION/i.test(trimmed)) {
      inProcedure = true;
      continue;
    }
    if (!inProcedure) continue;

    // Header must sit in/near Area A. Fixed-format cols 8-11 map to 0-3 leading
    // spaces here; the small tolerance also admits free-format paragraphs
    // indented a space or two, while excluding Area-B statements that share the
    // bare "WORD." shape (END-IF., GOBACK.).
    if (content.length - content.trimStart().length > 3) continue;

    const sec = trimmed.match(COBOL_SECTION);
    if (sec) {
      const base = sec[1].toUpperCase();
      if (!NON_PROC_SECTION.has(base)) {
        headers.push({ name: `${base} SECTION`, line: i + 1 });
      }
      continue;
    }
    const para = trimmed.match(COBOL_PARA);
    if (para) {
      const name = para[1].toUpperCase();
      if (!NON_PARA.has(name) && !name.startsWith("END-")) {
        headers.push({ name, line: i + 1 });
      }
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

function splitFiles(files: InputFile[]): { units: CodeUnit[]; skipped: string[] } {
  const units: CodeUnit[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const fileUnits =
      detectLanguage(f.filename) === "cobol"
        ? (() => {
            const cobolUnits = splitCobol(f.filename, f.content);
            // If splitting found nothing usable, fall back to whole-file unit.
            return cobolUnits.length > 0 ? cobolUnits : [wholeFileUnit(f)];
          })()
        : [wholeFileUnit(f)];

    // Never split a single file's units across the cap boundary — slicing
    // mid-file silently drops paragraphs from whichever file happens to
    // cross the line, making it look like that file legitimately has only
    // a couple of chunks. Drop the whole file instead so it's visibly
    // absent (via `skipped`) rather than silently incomplete.
    if (units.length + fileUnits.length > MAX_UNITS) {
      skipped.push(f.filename);
      continue;
    }
    units.push(...fileUnits);
  }
  return { units, skipped };
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

// Resolve a PERFORM / CALL / GO TO target name to the unit it actually refers
// to. A plain name-equality check misses the two most common real-world COBOL
// shapes, which is why repos rendered as nodes with no connecting edges:
//   • SECTION units are stored as "NAME SECTION" but performed as just "NAME".
//   • Cross-program CALL 'PROG' targets a PROGRAM-ID / file, not a paragraph.
// Paragraph and section names are registered first so an exact paragraph match
// always wins over a program-level (PROGRAM-ID / filename) fallback.
function buildCallResolver(
  units: CodeUnit[],
  files: InputFile[],
): Map<string, CodeUnit> {
  const resolve = new Map<string, CodeUnit>();
  const reg = (key: string, u: CodeUnit) => {
    const k = key.toUpperCase();
    if (k && !resolve.has(k)) resolve.set(k, u);
  };

  for (const u of units) {
    reg(u.name, u);
    const bare = u.name.replace(/\s+SECTION$/i, "");
    if (bare !== u.name) reg(bare, u);
  }

  // Program-level entry points: PROGRAM-ID and file stem → that file's first
  // unit, so a cross-program CALL lands on the callee's entry paragraph.
  const entryByFile = new Map<string, CodeUnit>();
  for (const u of units) if (!entryByFile.has(u.file)) entryByFile.set(u.file, u);
  for (const f of files) {
    const entry = entryByFile.get(f.filename);
    if (!entry) continue;
    const pid = f.content.match(/\bPROGRAM-ID\.\s*([A-Z0-9][A-Z0-9-]*)/i)?.[1];
    if (pid) reg(pid, entry);
    reg(f.filename.replace(/\.[^.]+$/, ""), entry);
  }

  return resolve;
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
  const { units, skipped: filesSkipped } = splitFiles(usable);
  if (filesSkipped.length > 0) {
    console.warn(
      `analyzeFiles: MAX_UNITS (${MAX_UNITS}) reached — skipped entirely: ${filesSkipped.join(", ")}`,
    );
  }

  // Fan-in: how many units call each unit. Resolve targets through the same
  // resolver used for edges so section / cross-program calls are counted too.
  const resolveCall = buildCallResolver(units, usable);
  const fanIn = new Map<string, number>();
  for (const u of units) {
    for (const c of u.calls) {
      const target = resolveCall.get(c);
      if (target && target.name !== u.name) {
        fanIn.set(target.name, (fanIn.get(target.name) ?? 0) + 1);
      }
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
      source_file: unit.file,
      start_line: unit.startLine,
      end_line: unit.endLine,
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
        ownership_evidence:
          "Low-confidence static/offline inference. Backend classifier is canonical for persisted overlay ownership.",
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
  const edges: { source: string; target: string }[] = [];
  const seenEdges = new Set<string>();
  for (const u of units) {
    for (const c of u.calls) {
      const target = resolveCall.get(c);
      if (!target || target.name === u.name) continue;
      const key = `${u.name} ${target.name}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ source: u.name, target: target.name });
    }
  }

  const scoreValues = Object.values(riskScores);
  const avgRisk = scoreValues.length
    ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
    : 0;

  const projectFiles: ProjectFile[] = usable.map((f) => ({
    filename: f.filename,
    content: f.content,
    language: detectLanguage(f.filename),
  }));

  return {
    projectName: meta.projectName,
    source: meta.source,
    chunks,
    businessRules,
    dependencyGraph: { nodes, edges },
    riskScores,
    targetProfile: DEFAULT_PROFILE,
    files: projectFiles,
    summary: {
      files: usable.length,
      units: units.length,
      avgRisk: Number(avgRisk.toFixed(3)),
      byLevel,
      filesSkipped,
    },
  };
}
