// lib/analyze.ts - Deterministic, rule-based analysis of uploaded legacy code.
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
    /** Filenames dropped entirely because MAX_UNITS was reached - empty in the common case. */
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
  language: "cobol" | "java" | "vb6" | "generic";
  source: string;
  startLine: number;
  endLine: number;
  calls: string[];
  /** VB6 only: owning module/class/form (VB_Name) - used for intra-module call resolution. */
  module?: string;
}

function detectLanguage(filename: string): "cobol" | "java" | "vb6" | "generic" {
  if (/\.(cbl|cob|cobol|cpy)$/i.test(filename)) return "cobol";
  if (/\.java$/i.test(filename)) return "java";
  if (/\.(bas|cls|frm|ctl)$/i.test(filename)) return "vb6";
  return "generic";
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

// SECTION names that belong to the DATA / ENVIRONMENT divisions - never the
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
    const lang = detectLanguage(f.filename);
    const fileUnits =
      lang === "cobol"
        ? (() => {
            const cobolUnits = splitCobol(f.filename, f.content);
            // If splitting found nothing usable, fall back to whole-file unit.
            return cobolUnits.length > 0 ? cobolUnits : [wholeFileUnit(f)];
          })()
        : lang === "java"
          ? splitJava(f.filename, f.content) // always returns >= 1 unit
          : lang === "vb6"
            ? (() => {
                const vbUnits = splitVB6(f.filename, f.content);
                return vbUnits.length > 0 ? vbUnits : [wholeFileUnit(f)];
              })()
            : [wholeFileUnit(f)];

    // Never split a single file's units across the cap boundary - slicing
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
// Java splitting - one unit per top-level type; edges via type references.
// Java's real dependency structure is class-to-class (not COBOL's flat PERFORM
// call graph), so we model it at class granularity: each class node links to
// every OTHER project class it names by type (field/param/return/new/extends…).
// ─────────────────────────────────────────────────────────────────────────────

// Replace comment and string/char-literal *contents* with spaces (preserving
// newlines) so braces, parens and keywords inside them can't confuse detection.
function maskJava(content: string): string {
  const out = content.split("");
  const n = content.length;
  const blank = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = content[i];
    const d = content[i + 1];
    if (c === "/" && d === "/") {
      let j = i + 2;
      while (j < n && content[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(content[j] === "*" && content[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      blank(i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && content[j] !== c) {
        if (content[j] === "\\") j++;
        j++;
      }
      j = Math.min(n, j + 1);
      blank(i + 1, j - 1);
      i = j;
    } else {
      i++;
    }
  }
  return out.join("");
}

// Capitalised identifiers referenced in a class body = its candidate type deps.
// Edges only ever form to a KNOWN project class, so JDK/framework types (String,
// List, @Override, …) are self-filtered out - no allow-list needed.
function javaTypeRefs(maskedBody: string, exclude: Set<string>): string[] {
  const refs = new Set<string>();
  const re = /\b([A-Z][\w$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(maskedBody))) {
    if (!exclude.has(m[1])) refs.add(m[1]);
  }
  return [...refs];
}

function splitJava(file: string, content: string): CodeUnit[] {
  const masked = maskJava(content);
  const lineAt = (index: number) => masked.slice(0, Math.max(0, index)).split("\n").length;

  // All type declarations, flagged as top-level (opened at brace depth 0).
  const decls: { name: string; index: number; top: boolean }[] = [];
  const re = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    let depth = 0;
    for (let k = 0; k < m.index; k++) {
      const ch = masked[k];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    decls.push({ name: m[1], index: m.index, top: depth === 0 });
  }

  const tops = decls.filter((d) => d.top);
  if (tops.length === 0) {
    // No type declaration (e.g. package-info.java) - keep as a single unit.
    const name = file.replace(/\.[^.]+$/, "");
    return [{
      id: slug(file, name),
      name,
      file,
      language: "java",
      source: content,
      startLine: 1,
      endLine: content.split("\n").length,
      calls: javaTypeRefs(masked, new Set([name])),
    }];
  }

  // Exclude every type declared in THIS file (self + siblings + nested) so a
  // class links only to classes defined elsewhere in the project.
  const localTypeNames = new Set(decls.map((d) => d.name));
  const units: CodeUnit[] = [];
  for (let t = 0; t < tops.length; t++) {
    const start = tops[t].index;
    const end = t + 1 < tops.length ? tops[t + 1].index : content.length;
    units.push({
      id: slug(file, tops[t].name),
      name: tops[t].name,
      file,
      language: "java",
      source: content.slice(start, end),
      startLine: lineAt(start),
      endLine: lineAt(end - 1),
      calls: javaTypeRefs(masked.slice(start, end), localTypeNames),
    });
  }
  return units;
}

// ─────────────────────────────────────────────────────────────────────────────
// VB6 splitting - one unit per procedure (Sub / Function / Property), edges via
// resolved call targets. VB6 legacy apps are procedural (like COBOL): modules
// full of Subs/Functions that Call each other across .bas/.cls/.frm files, so
// we model it as a procedure call graph, not a class-reference graph.
// ─────────────────────────────────────────────────────────────────────────────

// Statement/declaration keywords that can start a line - excluded when guessing
// a bare (parenless) Sub call from the first token of a statement.
const VB_KEYWORDS = new Set([
  "IF", "THEN", "ELSE", "ELSEIF", "END", "ENDIF", "FOR", "NEXT", "DO", "LOOP",
  "WHILE", "WEND", "SELECT", "CASE", "WITH", "SET", "LET", "DIM", "REDIM",
  "CONST", "STATIC", "PUBLIC", "PRIVATE", "FRIEND", "GLOBAL", "SUB", "FUNCTION",
  "PROPERTY", "EXIT", "ON", "ERROR", "RESUME", "GOTO", "GOSUB", "RETURN", "CALL",
  "OPEN", "CLOSE", "PRINT", "GET", "PUT", "WRITE", "INPUT", "LINE", "ERASE",
  "RANDOMIZE", "OPTION", "DECLARE", "TYPE", "ENUM", "REM", "STOP", "DOEVENTS",
  "ME", "NOTHING", "TRUE", "FALSE", "AND", "OR", "NOT", "XOR", "IS", "NEW",
  "BYVAL", "BYREF", "AS", "TO", "STEP", "EACH", "IN", "BEGIN", "ATTRIBUTE",
  "VERSION", "MSGBOX", "DEBUG", "APP", "ERR", "SCREEN", "OPTIONAL", "PARAMARRAY",
  "EMPTY", "NULL", "MOD", "LIKE", "WITHEVENTS", "EVENT", "RAISEEVENT", "IMPLEMENTS",
]);

// Blank VB6 comments ( ' … EOL, and whole-line Rem ) and string-literal contents
// so keywords/identifiers inside them can't be mistaken for procedures or calls.
// VB6 escapes a quote inside a string by doubling it ("").
function maskVB6(content: string): string {
  return content.split("\n").map((raw) => {
    if (/^\s*Rem\b/i.test(raw)) return raw.replace(/\S/g, " ");
    let out = "";
    let inStr = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inStr) {
        if (c === '"') {
          if (raw[i + 1] === '"') { out += "  "; i++; } // escaped quote
          else { out += '"'; inStr = false; }
        } else out += " ";
      } else if (c === '"') { inStr = true; out += '"'; }
      else if (c === "'") { out += " ".repeat(raw.length - i); break; }
      else out += c;
    }
    return out;
  }).join("\n");
}

const VB_PROC_HDR =
  /^\s*(?:(?:Public|Private|Friend|Global)\s+)?(?:Static\s+)?(?:Sub|Function|Property\s+(?:Get|Let|Set))\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const VB_PROC_END = /^\s*End\s+(?:Sub|Function|Property)\b/i;

// Candidate call targets in a (masked) procedure body: Call X / Call M.X,
// F(...) function calls, qualified M.P / obj.Method, and bare statement calls.
function extractVBCalls(body: string): string[] {
  const calls = new Set<string>();
  let m: RegExpExecArray | null;
  const callKw = /\bCall\s+([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/gi;
  while ((m = callKw.exec(body))) {
    if (m[2]) { calls.add(m[2]); calls.add(`${m[1]}.${m[2]}`); }
    else calls.add(m[1]);
  }
  const paren = /\b([A-Za-z_]\w*)\s*\(/g;
  while ((m = paren.exec(body))) calls.add(m[1]);
  const qualified = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g;
  while ((m = qualified.exec(body))) { calls.add(m[2]); calls.add(`${m[1]}.${m[2]}`); }
  for (const line of body.split("\n")) {
    // Bare statement call: "Foo args" or a lone "Foo", but not an assignment
    // (Foo =), label (Foo:), member ref (Foo.) or the start of an expression.
    const b = line.match(/^\s*([A-Za-z_]\w*)(?:\s+(?![=.(:&<>+\-*/\\^])|\s*$)/);
    if (b && !VB_KEYWORDS.has(b[1].toUpperCase())) calls.add(b[1]);
  }
  return [...calls];
}

function splitVB6(file: string, content: string): CodeUnit[] {
  const masked = maskVB6(content);
  const mLines = masked.split("\n");
  const rawLines = content.split("\n");
  const module =
    content.match(/Attribute\s+VB_Name\s*=\s*"([^"]+)"/i)?.[1] ??
    file.replace(/\.[^.]+$/, "");

  const units: CodeUnit[] = [];
  let cur: { proc: string; start: number } | null = null;
  const close = (endLine: number) => {
    if (!cur) return;
    const name = `${module}.${cur.proc}`;
    units.push({
      id: slug(file, name),
      name,
      file,
      language: "vb6",
      module,
      source: rawLines.slice(cur.start - 1, endLine).join("\n"),
      startLine: cur.start,
      endLine,
      calls: extractVBCalls(mLines.slice(cur.start - 1, endLine).join("\n")),
    });
    cur = null;
  };

  for (let i = 0; i < mLines.length; i++) {
    const hdr = mLines[i].match(VB_PROC_HDR);
    if (hdr) {
      if (cur) close(i); // defensive: previous proc had no End marker
      cur = { proc: hdr[1], start: i + 1 };
      continue;
    }
    if (cur && VB_PROC_END.test(mLines[i])) close(i + 1);
  }
  if (cur) close(mLines.length);
  return units;
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk RULES - every tier is derived, nothing hardcoded
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

  // Rule 1 - touches money.
  if (MONEY_WORDS.test(src)) {
    score += 0.3;
    reasons.push("Touches money");
  }
  // Rule 2 - packed-decimal precision.
  if (/COMP-3|COMPUTATIONAL-3|PACKED-DECIMAL/i.test(src)) {
    score += 0.18;
    reasons.push("Packed-decimal arithmetic");
  }
  // Rule 3 - non-trivial financial arithmetic.
  if (/\b(COMPUTE|MULTIPLY|DIVIDE)\b/i.test(src)) {
    score += 0.12;
    reasons.push("Computed arithmetic");
  }
  // Rule 4 - blast radius from inbound calls.
  if (fanIn >= 2) {
    score += clamp01(fanIn * 0.08);
    if (fanIn >= 3) reasons.push(`High fan-in (${fanIn} callers)`);
  }
  // Rule 5 - magic numbers.
  const values = magicNumbers(src);
  if (values.length >= 2) {
    score += Math.min(values.length * 0.025, 0.12);
    if (values.length >= 4)
      reasons.push(`${values.length} hardcoded values`);
  }
  // Rule 6 - commented-out / dead code. The comment leader differs by language;
  // Java javadoc lines also start with "*", so skip Java to avoid misfires.
  const lines = src.split("\n");
  if (unit.language !== "java") {
    const isDead =
      unit.language === "vb6"
        ? (l: string) => l.trimStart().startsWith("'") || /^\s*Rem\b/i.test(l)
        : (l: string) => l.trim().startsWith("*");
    const dead = lines.filter(isDead).length;
    const deadRatio = lines.length ? dead / lines.length : 0;
    if (deadRatio > 0.12) {
      score += Math.min(deadRatio * 0.3, 0.1);
      reasons.push("Commented-out code present");
    }
  }
  // Rule 7 - external I/O / DB. Skipped for VB6, where CALL is a plain procedure
  // invocation (not I/O) and would fire on nearly every unit; VB6 gets its own
  // DB-access signal below.
  if (unit.language !== "vb6" && /\b(EXEC\s+SQL|CALL|WRITE|READ|REWRITE|DELETE)\b/i.test(src)) {
    score += 0.08;
    reasons.push("External I/O");
  }
  // Rule 8 - size.
  score += Math.min(lines.length / 400, 0.1);

  // Java-specific signals.
  if (unit.language === "java") {
    if (/\b(?:float|double)\b/.test(src) && MONEY_WORDS.test(src)) {
      score += 0.2;
      reasons.push("float/double on monetary value");
    }
    if (/\b(?:executeQuery|executeUpdate|PreparedStatement|createStatement|Statement|EntityManager|createQuery|getConnection)\b/.test(src)) {
      score += 0.1;
      reasons.push("Database access");
    }
  }

  // VB6-specific signals.
  if (unit.language === "vb6") {
    if (/\b(?:Single|Double)\b/i.test(src) && MONEY_WORDS.test(src)) {
      score += 0.2;
      reasons.push("Single/Double on monetary value");
    }
    if (/\bVariant\b/i.test(src)) {
      score += 0.06;
      reasons.push("Loosely-typed Variant");
    }
    if (/On\s+Error\s+Resume\s+Next/i.test(src)) {
      score += 0.1;
      reasons.push("Errors silently swallowed (On Error Resume Next)");
    }
    if (/\b(?:ADODB|Recordset|Connection)\b|\.Execute\b|\b(?:SELECT|INSERT|UPDATE)\b/i.test(src)) {
      score += 0.1;
      reasons.push("Database access");
    }
    if (/\bGo(?:To|Sub)\b/i.test(src)) {
      score += 0.05;
      reasons.push("GoTo/GoSub control flow");
    }
  }

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
  if (unit.language === "java") return "section"; // one node per class
  if (unit.language === "vb6") return "paragraph"; // one node per procedure
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

// Build all dependency edges + fan-in counts across languages. COBOL/generic
// units resolve PERFORM/CALL targets through buildCallResolver; Java is modelled
// at class granularity - each class links to every other project class it names.
function buildGraphEdges(
  units: CodeUnit[],
  files: InputFile[],
): { edges: { source: string; target: string }[]; fanIn: Map<string, number> } {
  const edges: { source: string; target: string }[] = [];
  const fanIn = new Map<string, number>();
  const seen = new Set<string>();
  const add = (source: string, targetName: string) => {
    if (!targetName || targetName === source) return;
    const key = `${source}\u0000${targetName}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target: targetName });
    fanIn.set(targetName, (fanIn.get(targetName) ?? 0) + 1);
  };

  // COBOL (and generic fallback) - PERFORM/CALL/GO TO resolution.
  const cobolResolve = buildCallResolver(
    units.filter((u) => u.language === "cobol" || u.language === "generic"),
    files,
  );
  for (const u of units) {
    if (u.language !== "cobol" && u.language !== "generic") continue;
    for (const c of u.calls) {
      const target = cobolResolve.get(c);
      if (target) add(u.name, target.name);
    }
  }

  // Java - connect a class to every other project class it references by type.
  const javaByName = new Map<string, CodeUnit>();
  for (const u of units) if (u.language === "java") javaByName.set(u.name, u);
  for (const u of units) {
    if (u.language !== "java") continue;
    for (const c of u.calls) {
      const target = javaByName.get(c);
      if (target) add(u.name, target.name);
    }
  }

  // VB6 - procedure call graph. Resolve a qualified Module.Proc precisely; a
  // bare Proc resolves to the caller's own module first, then to any module.
  const vbByQualified = new Map<string, CodeUnit>();
  const vbByProc = new Map<string, CodeUnit>();
  for (const u of units) {
    if (u.language !== "vb6") continue;
    vbByQualified.set(u.name.toUpperCase(), u);
    const proc = (u.module ? u.name.slice(u.module.length + 1) : u.name).toUpperCase();
    if (!vbByProc.has(proc)) vbByProc.set(proc, u);
  }
  for (const u of units) {
    if (u.language !== "vb6") continue;
    const mod = (u.module ?? "").toUpperCase();
    for (const c of u.calls) {
      const cu = c.toUpperCase();
      const target = cu.includes(".")
        ? vbByQualified.get(cu)
        : vbByQualified.get(`${mod}.${cu}`) ?? vbByProc.get(cu);
      if (target) add(u.name, target.name);
    }
  }

  return { edges, fanIn };
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
  notes: "All monetary math uses decimal.Decimal - never float.",
};

export function analyzeFiles(
  files: InputFile[],
  meta: { projectName: string; source: string },
): AnalyzeResult {
  const usable = files.filter((f) => f.content && f.content.trim().length > 0);
  const { units, skipped: filesSkipped } = splitFiles(usable);
  if (filesSkipped.length > 0) {
    console.warn(
      `analyzeFiles: MAX_UNITS (${MAX_UNITS}) reached - skipped entirely: ${filesSkipped.join(", ")}`,
    );
  }

  // Dependency edges + fan-in across languages (COBOL PERFORM/CALL graph, Java
  // class-reference graph). Computed once, up front, so risk scoring below can
  // use fan-in.
  const { edges, fanIn } = buildGraphEdges(units, usable);

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

  // Nodes: one per unit (COBOL paragraph/section, Java class). Edges were
  // computed above in buildGraphEdges.
  const nodes: DependencyNode[] = units.map((u) => ({
    id: u.name,
    label: u.name,
    file: u.file,
    type: nodeType(u),
  }));

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
