// lib/imports.ts - Collect, de-duplicate, and hoist the import/using/#include
// lines out of individually-migrated chunks so an assembled file carries each
// import exactly once, at the top, instead of repeating it after every chunk
// (and stranding imports in the middle of the file).
//
// Chunk concatenation can never guarantee a fully compiling file for languages
// where a source file is a single package / single public class (Java, Go), but
// hoisting removes the most obvious and most common breakage: duplicated and
// mid-file import statements. Recognition is deliberately line-oriented and
// conservative - anything we don't confidently recognise as an import is left
// untouched in the chunk body.

/** How one language's top-of-file declarations are recognised. Every predicate
 *  runs on an already-trimmed line. */
interface LanguageImportRules {
  /** An import / using / #include / use statement (may open a multi-line block). */
  isImport(line: string): boolean;
  /** A once-per-file header declaration hoisted above imports (e.g. `package x;`). */
  isHeaderDecl?(line: string): boolean;
}

const RULES: Record<string, LanguageImportRules> = {
  Python: {
    // `import x`, `import x as y`, `from x import ...`, `from . import ...`
    isImport: (l) => /^(?:import\s+\S|from\s+\S+\s+import\b)/.test(l),
  },
  TypeScript: {
    // `import ...`, `import type ...`, side-effect `import './x'`
    isImport: (l) => /^import\b/.test(l),
  },
  JavaScript: {
    isImport: (l) => /^import\b/.test(l),
  },
  Java: {
    isImport: (l) => /^import\s+(?:static\s+)?[\w.$*]+\s*;/.test(l),
    isHeaderDecl: (l) => /^package\s+[\w.]+\s*;/.test(l),
  },
  Go: {
    // single `import "x"` or a multi-line `import ( ... )` block
    isImport: (l) => /^import\b/.test(l),
    isHeaderDecl: (l) => /^package\s+\w+/.test(l),
  },
  Rust: {
    isImport: (l) => /^(?:pub(?:\([^)]*\))?\s+)?use\s+/.test(l) || /^extern\s+crate\s+/.test(l),
  },
  "C++": {
    isImport: (l) =>
      /^#\s*include\b/.test(l) ||
      /^using\s+namespace\s+[\w:]+\s*;/.test(l) ||
      /^import\s+[\w:<>."]+\s*;/.test(l),
  },
  "C#": {
    // `using System;`, `using static X.Y;`, `global using X;`, `using Foo = Bar;`
    // but NOT the `using (resource)` / `using var x = ...` statement forms.
    isImport: (l) =>
      /^(?:global\s+)?using\s+(?:static\s+)?[\w.]+\s*(?:=\s*[\w.]+\s*)?;\s*$/.test(l) &&
      !/^using\s+var\b/.test(l),
  },
  // SQL has no import mechanism worth de-duplicating - left as-is.
};

/** Depth of unclosed (), [], {} across a statement so far. Import blocks
 *  (Go `import ( … )`, Python `from x import ( … )`, multi-line TS `import { … }`)
 *  keep consuming lines until this returns to zero. */
function bracketDepth(text: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
  }
  return depth;
}

/** True while a Python statement is continued onto the next physical line. */
function isContinued(stmt: string): boolean {
  if (bracketDepth(stmt) > 0) return true;
  return /\\\s*$/.test(stmt); // trailing backslash line-continuation
}

interface Extracted {
  headerDecls: string[];
  imports: string[];
  /** The chunk with header/import lines removed and surrounding blanks trimmed. */
  body: string;
}

/** Pull header declarations and import statements out of a single chunk. */
function extractFromChunk(code: string, rules: LanguageImportRules): Extracted {
  const lines = code.split("\n");
  const headerDecls: string[] = [];
  const imports: string[] = [];
  const bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (rules.isHeaderDecl?.(trimmed)) {
      headerDecls.push(trimmed);
      continue;
    }

    if (rules.isImport(trimmed)) {
      // Consume any continuation lines so multi-line import blocks stay intact.
      let stmt = raw;
      while (isContinued(stmt) && i + 1 < lines.length) {
        i++;
        stmt += "\n" + lines[i];
      }
      imports.push(stmt);
      continue;
    }

    bodyLines.push(raw);
  }

  return {
    headerDecls,
    imports,
    body: bodyLines.join("\n").trim(),
  };
}

/** Stable de-dup key for a (possibly multi-line) statement. */
function dedupeKey(stmt: string): string {
  return stmt
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
}

function dedupe(statements: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of statements) {
    const key = dedupeKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.trim());
  }
  return out;
}

/** Split `from mod import a, b as c` -> ["a", "b as c"], or null if we can't
 *  safely merge it (parenthesised/multi-line, star, trailing comment). */
function pythonFromParts(stmt: string): { module: string; symbols: string[] } | null {
  if (stmt.includes("\n") || stmt.includes("(") || stmt.includes("#")) return null;
  const m = stmt.match(/^from\s+(\S+)\s+import\s+(.+)$/);
  if (!m) return null;
  const symbols = m[2]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (symbols.length === 0 || symbols.includes("*")) return null;
  return { module: m[1], symbols };
}

/** Python import ordering + merge: __future__ first, then plain `import`, then
 *  `from` imports with symbols from the same module unioned onto one line. */
function organizePythonImports(imports: string[]): string[] {
  const deduped = dedupe(imports);
  const future: string[] = [];
  const plain: string[] = [];
  const fromOrder: string[] = []; // module names, first-seen order
  const fromSymbols = new Map<string, string[]>(); // module -> unioned symbols
  const opaqueFrom: string[] = []; // from-imports we won't merge, kept verbatim

  for (const stmt of deduped) {
    if (/^from\s+__future__\b/.test(stmt)) {
      future.push(stmt);
    } else if (/^import\b/.test(stmt)) {
      plain.push(stmt);
    } else {
      const parts = pythonFromParts(stmt);
      if (!parts) {
        opaqueFrom.push(stmt);
        continue;
      }
      if (!fromSymbols.has(parts.module)) {
        fromOrder.push(parts.module);
        fromSymbols.set(parts.module, []);
      }
      const acc = fromSymbols.get(parts.module)!;
      for (const sym of parts.symbols) if (!acc.includes(sym)) acc.push(sym);
    }
  }

  const merged = fromOrder.map(
    (mod) => `from ${mod} import ${fromSymbols.get(mod)!.join(", ")}`,
  );
  return [...future, ...plain, ...merged, ...opaqueFrom];
}

/** Go rejects a package imported twice, so normalise every `import "x"` and
 *  `import ( … )` block into individual specs, dedupe, and re-emit as one block. */
function organizeGoImports(imports: string[]): string[] {
  const specs: string[] = [];
  for (const stmt of imports) {
    const block = stmt.match(/^import\s*\(([\s\S]*)\)\s*$/);
    if (block) {
      for (const line of block[1].split("\n")) {
        const spec = line.trim();
        if (spec) specs.push(spec);
      }
    } else {
      const single = stmt.replace(/^import\s+/, "").trim();
      if (single) specs.push(single);
    }
  }
  const unique = dedupe(specs);
  if (unique.length === 0) return [];
  if (unique.length === 1) return [`import ${unique[0]}`];
  return [`import (\n${unique.map((s) => `\t${s}`).join("\n")}\n)`];
}

export interface HoistedImports {
  /** Deduped header declarations (e.g. `package x;`) for the very top of the file. */
  headerDecls: string[];
  /** Deduped (and, for Python, merged) import statements for the top of the file. */
  imports: string[];
  /** Each chunk's body with its header/import lines removed. */
  bodies: string[];
}

/**
 * Hoist imports out of every chunk of one assembled file.
 *
 * @param language  Target language name (`TargetLanguage.language`).
 * @param chunkCodes  Each chunk's migrated code, in the order it should appear.
 * @param extraImports  Import lines the assembler wants merged in regardless of
 *   whether any chunk declared them (e.g. Python's mandated Decimal import).
 */
export function hoistImports(
  language: string,
  chunkCodes: string[],
  extraImports: string[] = [],
): HoistedImports {
  const rules = RULES[language];

  // Languages we don't model (e.g. SQL): pass chunks through untouched.
  if (!rules) {
    return { headerDecls: [], imports: [], bodies: chunkCodes.map((c) => c.trim()) };
  }

  const headerDecls: string[] = [];
  const imports: string[] = [...extraImports];
  const bodies: string[] = [];

  for (const code of chunkCodes) {
    const extracted = extractFromChunk(code, rules);
    headerDecls.push(...extracted.headerDecls);
    imports.push(...extracted.imports);
    bodies.push(extracted.body);
  }

  let finalImports: string[];
  if (language === "Python") finalImports = organizePythonImports(imports);
  else if (language === "Go") finalImports = organizeGoImports(imports);
  else finalImports = dedupe(imports);

  return {
    headerDecls: dedupe(headerDecls),
    imports: finalImports,
    bodies,
  };
}
