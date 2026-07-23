// lib/targetApi.ts - Builds the "ALREADY-MIGRATED TARGET API" block: a compact,
// deterministic contract of the target code that has ALREADY been generated for
// the units a chunk depends on (and its same-file siblings), so the model calls
// the real generated names/signatures instead of inventing new ones. This is the
// generated-side half of cross-chunk context; the source-side half is the DIRECT
// DEPENDENCIES block (buildDependenciesSource), the legacy source of the units
// this chunk calls.
//
// Client twin of server/core/migration/target_api.py.

import type {
  BusinessRule,
  DependencyGraph,
  MigrationChunk,
} from "@/types/legacylift";
import type { TargetLanguage } from "@/lib/targetLanguages";
import { extractExports, isEmptySurface, surfaceLines } from "@/lib/symbols";

const MAX_API_CHARS = 9_000;
const MAX_DEP_SOURCE_CHARS = 12_000;

/** filename without its extension: "interest_calc.cbl" -> "interest_calc". */
function stem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Resolve a graph key (node id OR unit name) to a chunk - tolerates both the
 *  offline (name-keyed) and backend (id-keyed) client graph shapes. */
function makeResolver(chunks: MigrationChunk[]): (key: unknown) => MigrationChunk | undefined {
  const byId = new Map(chunks.map((c) => [c.id, c] as const));
  const byName = new Map(chunks.map((c) => [c.name, c] as const));
  return (key) =>
    typeof key === "string" ? byId.get(key) ?? byName.get(key) : undefined;
}

function isDataEdge(edge: { label?: string; edge_type?: string }): boolean {
  const kind = (edge.label ?? edge.edge_type ?? "").toLowerCase();
  return kind.includes("data");
}

/** The chunks this chunk directly calls (resolved graph call edges). */
export function directDependencies(
  chunks: MigrationChunk[],
  graph: DependencyGraph | null,
  current: MigrationChunk,
): MigrationChunk[] {
  const resolve = makeResolver(chunks);
  const out: MigrationChunk[] = [];
  const seen = new Set<string>();
  for (const edge of graph?.edges ?? []) {
    if (isDataEdge(edge as { label?: string; edge_type?: string })) continue;
    const src = resolve(edge.source);
    if (!src || src.id !== current.id) continue;
    const tgt = resolve(edge.target);
    if (tgt && tgt.id !== current.id && !seen.has(tgt.id)) {
      seen.add(tgt.id);
      out.push(tgt);
    }
  }
  return out;
}

/** Render an ordered list of already-generated units as compact API blocks. */
function renderApiBlocks(
  units: MigrationChunk[],
  resolveTarget: (filename: string) => TargetLanguage,
  maxChars: number,
): string {
  const blocks: string[] = [];
  for (const c of units) {
    if (!(c.migrated_code ?? "").trim()) continue;
    const target = resolveTarget(c.source_file);
    const surface = extractExports(c.migrated_code, target.language);
    if (isEmptySurface(surface)) continue;

    const status = c.status === "Approved" ? "approved" : "draft";
    const header = `- ${c.name}  ->  ${stem(c.source_file)}${target.extension}  [${status}]`;
    const candidate = [header, ...surfaceLines(surface)].join("\n");

    if (blocks.length && blocks.join("\n").length + candidate.length > maxChars) break;
    blocks.push(candidate);
  }
  return blocks.join("\n");
}

/**
 * Render the already-generated target API relevant to `current`: its direct
 * dependencies first, then same-file siblings, then any other generated unit,
 * budget-capped. Only units that already have generated code are included.
 */
export function buildTargetApi(
  chunks: MigrationChunk[],
  graph: DependencyGraph | null,
  current: MigrationChunk,
  resolveTarget: (filename: string) => TargetLanguage,
  maxChars = MAX_API_CHARS,
): string {
  const deps = directDependencies(chunks, graph, current);
  const siblings = chunks.filter(
    (c) => c.id !== current.id && c.source_file === current.source_file,
  );

  const ordered: MigrationChunk[] = [];
  const seen = new Set<string>([current.id]);
  for (const group of [deps, siblings, chunks]) {
    for (const c of group) {
      if (!seen.has(c.id) && (c.migrated_code ?? "").trim()) {
        ordered.push(c);
        seen.add(c.id);
      }
    }
  }

  return renderApiBlocks(ordered, resolveTarget, maxChars);
}

/**
 * Render the already-generated target API of units in OTHER files, so a file
 * being finalized reconciles its cross-file references to real neighbour
 * names/signatures rather than only fixing within-file drift.
 */
export function buildCrossFileApi(
  chunks: MigrationChunk[],
  resolveTarget: (filename: string) => TargetLanguage,
  currentFilename: string,
  maxChars = MAX_API_CHARS,
): string {
  const others = chunks.filter(
    (c) => c.source_file !== currentFilename && (c.migrated_code ?? "").trim(),
  );
  return renderApiBlocks(others, resolveTarget, maxChars);
}

/**
 * Render the legacy SOURCE of the units this chunk calls (+ their extracted
 * rule) for the DIRECT DEPENDENCIES block - the source-side half of "both".
 */
export function buildDependenciesSource(
  chunks: MigrationChunk[],
  graph: DependencyGraph | null,
  current: MigrationChunk,
  rules: BusinessRule[],
  maxChars = MAX_DEP_SOURCE_CHARS,
): string {
  const ruleForChunk = (c: MigrationChunk): string => {
    const r =
      rules.find((x) => x.chunk_id === c.id) ??
      rules.find((x) => x.source_file === c.source_file && x.title === c.name);
    return r?.description ?? "";
  };

  const blocks: string[] = [];
  for (const dep of directDependencies(chunks, graph, current)) {
    const source = (dep.source_code ?? "").trim();
    if (!source) continue;
    const parts = [`--- ${dep.name} ---`];
    const rule = ruleForChunk(dep).trim();
    if (rule) parts.push(`rule: ${rule}`);
    parts.push(source);
    const candidate = parts.join("\n");
    if (blocks.length && blocks.join("\n\n").length + candidate.length > maxChars) break;
    blocks.push(candidate);
  }
  return blocks.join("\n\n");
}
