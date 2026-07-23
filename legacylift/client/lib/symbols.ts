// lib/symbols.ts - Deterministic extraction of a migrated unit's PUBLIC
// target-language API surface (function/method signatures, exported types, and
// module-level constants) from its generated code.
//
// This is the client twin of server/utils/symbol_index.py. It exists so a chunk
// being migrated can be shown the REAL names/signatures of the units it already
// depends on (the "ALREADY-MIGRATED TARGET API" prompt block) instead of
// guessing a name another chunk actually generated differently.
//
// Recognition is deliberately conservative and line-oriented, mirroring the
// import-hoisting philosophy in lib/imports.ts: anything we don't confidently
// recognise as a public declaration is skipped rather than mis-reported.

export interface ExportSurface {
  /** Public function/method signature lines, e.g. "def calculate_interest(...) -> Decimal". */
  functions: string[];
  /** Exported type declarations, e.g. "class Account", "type Ledger struct". */
  types: string[];
  /** Module-level constant names, e.g. "PREMIUM_BONUS". */
  constants: string[];
}

type Bucket = "functions" | "types" | "constants";
interface Rule {
  bucket: Bucket;
  re: RegExp;
}

const MAX_SIG = 200;
const MAX_ITEMS = 40;

// Per-language declaration recognisers. Keyed by casefolded TargetLanguage.language.
const RULES: Record<string, Rule[]> = {
  python: [
    { bucket: "functions", re: /^(?:async\s+)?def\s+(?!_)\w+\s*\(/ },
    { bucket: "types", re: /^class\s+(?!_)\w+/ },
    { bucket: "constants", re: /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/ },
  ],
  java: [
    { bucket: "functions", re: /^(?:public|protected)\b.*\b\w+\s*\([^;]*\)\s*(?:throws[\w,\s.]*)?\{?\s*$/ },
    { bucket: "types", re: /^(?:public|protected)\b.*\b(?:class|interface|enum|record)\s+\w+/ },
    { bucket: "constants", re: /^(?:public|protected).*\bstatic\s+final\b.*\b(\w+)\s*=/ },
  ],
  "c#": [
    { bucket: "functions", re: /^(?:public|protected|internal)\b.*\b\w+\s*\([^;]*\)\s*\{?\s*$/ },
    { bucket: "types", re: /^(?:public|internal)\b.*\b(?:class|interface|enum|record|struct)\s+\w+/ },
    { bucket: "constants", re: /^(?:public|internal).*\b(?:const|static\s+readonly)\b.*\b(\w+)\s*=/ },
  ],
  "c++": [
    { bucket: "functions", re: /^[\w:<>,&*\s]+\s+\w+\s*\([^;]*\)\s*(?:const)?\s*\{?\s*$/ },
    { bucket: "types", re: /^(?:class|struct|enum(?:\s+class)?)\s+\w+/ },
    { bucket: "constants", re: /^(?:constexpr|const)\b.*\b(\w+)\s*=/ },
  ],
  rust: [
    { bucket: "functions", re: /^pub(?:\([^)]*\))?\s+(?:async\s+)?fn\s+\w+/ },
    { bucket: "types", re: /^pub(?:\([^)]*\))?\s+(?:struct|enum|trait|type)\s+\w+/ },
    { bucket: "constants", re: /^pub(?:\([^)]*\))?\s+(?:const|static)\s+(\w+)/ },
  ],
  go: [
    { bucket: "functions", re: /^func\s+(?:\([^)]*\)\s*)?[A-Z]\w*\s*\(/ },
    { bucket: "types", re: /^type\s+[A-Z]\w*\b/ },
    { bucket: "constants", re: /^(?:const|var)\s+([A-Z]\w*)\b/ },
  ],
  typescript: [
    { bucket: "functions", re: /^export\s+(?:async\s+)?function\s+\w+/ },
    { bucket: "types", re: /^export\s+(?:default\s+)?(?:abstract\s+)?(?:class|interface|type|enum)\s+\w+/ },
    { bucket: "constants", re: /^export\s+const\s+(\w+)/ },
  ],
  javascript: [
    { bucket: "functions", re: /^export\s+(?:async\s+)?function\s+\w+/ },
    { bucket: "types", re: /^export\s+(?:default\s+)?class\s+\w+/ },
    { bucket: "constants", re: /^export\s+const\s+(\w+)/ },
  ],
  sql: [
    { bucket: "types", re: /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w."`]+/i },
    { bucket: "functions", re: /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+[\w."`]+/i },
  ],
};

/** Net depth of unclosed ( ) across a string. */
function parenDepth(text: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  return depth;
}

/** A declaration head as a compact signature: drop the body opener + trailing
 *  punctuation, collapse whitespace, truncate. */
function cleanSignature(line: string): string {
  let sig = line.trim();
  const brace = sig.indexOf("{");
  if (brace !== -1) sig = sig.slice(0, brace);
  sig = sig.replace(/[\s:;]+$/, "");
  sig = sig.replace(/\s+/g, " ");
  return sig.slice(0, MAX_SIG).trim();
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

const COMMENT_STARTS = ["//", "#", "--", "*"];

export function extractExports(code: string, language: string): ExportSurface {
  const surface: ExportSurface = { functions: [], types: [], constants: [] };
  if (!code || !code.trim()) return surface;

  const canon = language.trim().toLowerCase();
  const rules = RULES[canon];
  if (!rules) return surface;

  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || COMMENT_STARTS.some((c) => line.startsWith(c))) continue;

    for (const { bucket, re } of rules) {
      const m = re.exec(line);
      if (!m) continue;

      if (bucket === "constants") {
        surface.constants.push(m[1] ?? cleanSignature(line));
      } else if (bucket === "types") {
        surface.types.push(cleanSignature(line));
      } else {
        // Functions: assemble multi-line signatures until parens balance.
        let stmt = lines[i];
        let depth = parenDepth(stmt);
        let j = i;
        while (depth > 0 && j + 1 < lines.length) {
          j++;
          stmt += " " + lines[j];
          depth = parenDepth(stmt);
        }
        i = j;
        surface.functions.push(cleanSignature(stmt));
      }
      break; // one bucket per line
    }
  }

  surface.functions = dedupe(surface.functions).slice(0, MAX_ITEMS);
  surface.types = dedupe(surface.types).slice(0, MAX_ITEMS);
  surface.constants = dedupe(surface.constants).slice(0, MAX_ITEMS);
  return surface;
}

/** True when nothing public was recognised. */
export function isEmptySurface(s: ExportSurface): boolean {
  return s.functions.length === 0 && s.types.length === 0 && s.constants.length === 0;
}

/** Render a surface as indented prompt lines (types, functions, then constants). */
export function surfaceLines(s: ExportSurface, indent = "    "): string[] {
  return [
    ...s.types.map((t) => `${indent}${t}`),
    ...s.functions.map((f) => `${indent}${f}`),
    ...s.constants.map((c) => `${indent}const ${c}`),
  ];
}
