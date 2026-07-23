// lib/impact.ts - Cross-chunk impact propagation: the "when I change one file I
// check everything that depends on it" behaviour a careful human applies by
// hand. When a unit's generated code changes (regeneration, AI fix, manual
// edit), we diff its public API surface before/after; if symbols that other
// units reference were renamed or removed, those dependents are flagged as
// needing a sync — and the engine can regenerate them with the updated
// ALREADY-MIGRATED TARGET API so the whole graph converges instead of silently
// drifting apart.
//
// Deterministic and local: no LLM calls here. The LLM is only involved when a
// flagged dependent is regenerated (with a precise instruction about what
// changed).

import type { DependencyGraph, MigrationChunk } from "@/types/legacylift";
import { extractExports, type ExportSurface } from "@/lib/symbols";
import { directDependencies } from "@/lib/targetApi";

/** Bare symbol name from a signature line: "def calc(a, b) -> X" -> "calc". */
function nameFromSignature(sig: string): string | null {
  const m = sig.match(/([A-Za-z_$][\w$]*)\s*\(/);
  return m ? m[1] : null;
}

/** Bare name from a type declaration: "class Account", "type Ledger struct". */
function nameFromType(decl: string): string | null {
  const m = decl.match(
    /\b(?:class|interface|enum|record|struct|trait|type|table|function|procedure)\s+([A-Za-z_$][\w$]*)/i,
  );
  return m ? m[1] : null;
}

/** The set of bare public symbol names a unit's generated code exposes. */
export function surfaceNames(surface: ExportSurface): string[] {
  const names = new Set<string>();
  for (const f of surface.functions) {
    const n = nameFromSignature(f);
    if (n) names.add(n);
  }
  for (const t of surface.types) {
    const n = nameFromType(t);
    if (n) names.add(n);
  }
  for (const c of surface.constants) names.add(c);
  return [...names];
}

/** Public symbol names of a piece of generated code (empty for empty code). */
export function exportedNames(code: string, language: string): string[] {
  if (!code.trim()) return [];
  return surfaceNames(extractExports(code, language));
}

/** Direct dependents of `id`: every chunk whose call edges point AT it. */
export function dependentsOf(
  chunks: MigrationChunk[],
  graph: DependencyGraph | null,
  id: string,
): MigrationChunk[] {
  return chunks.filter(
    (c) => c.id !== id && directDependencies(chunks, graph, c).some((d) => d.id === id),
  );
}

/** Which of `names` a piece of code actually references (word-boundary match). */
export function referencedNames(code: string, names: string[]): string[] {
  if (!code.trim() || names.length === 0) return [];
  return names.filter((n) =>
    new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(code),
  );
}

export interface ImpactReport {
  dependent: MigrationChunk;
  /** Old symbols of the changed unit that this dependent references. */
  referenced: string[];
  /** Referenced symbols that no longer exist after the change — real breakage. */
  broken: string[];
}

/**
 * Assess the blast radius of one unit's API change: for every direct dependent
 * that already has generated code, report which of the unit's OLD symbols it
 * references and which of those no longer exist. `broken` non-empty means the
 * dependent will not compile/run against the new code and needs a sync.
 */
export function assessImpact(
  chunks: MigrationChunk[],
  graph: DependencyGraph | null,
  changed: MigrationChunk,
  oldNames: string[],
  newNames: string[],
): ImpactReport[] {
  if (oldNames.length === 0) return []; // first generation — nothing referenced it yet
  const newSet = new Set(newNames);
  const reports: ImpactReport[] = [];
  for (const dep of dependentsOf(chunks, graph, changed.id)) {
    if (!dep.migrated_code.trim()) continue;
    const referenced = referencedNames(dep.migrated_code, oldNames);
    if (referenced.length === 0) continue;
    reports.push({
      dependent: dep,
      referenced,
      broken: referenced.filter((n) => !newSet.has(n)),
    });
  }
  return reports;
}

/** The regeneration instruction handed to a broken dependent's next attempt. */
export function syncInstruction(
  changedName: string,
  broken: string[],
  newNames: string[],
): string {
  return (
    `Dependency "${changedName}" changed its public API. ` +
    `The symbol(s) ${broken.map((b) => `\`${b}\``).join(", ")} no longer exist. ` +
    `Update every reference to match the ALREADY-MIGRATED TARGET API block exactly` +
    (newNames.length ? ` (it now exposes: ${newNames.join(", ")}).` : ".") +
    " Do not change any business logic — only fix the references."
  );
}
