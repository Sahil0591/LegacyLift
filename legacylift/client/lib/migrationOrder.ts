// lib/migrationOrder.ts - Dependency-ordered chunk migration.
//
// Legacy programs are graphs of units that PERFORM/CALL one another. Migrating a
// caller before its callees forces the caller to *guess* the callee's target
// name/signature - the root cause of cross-unit naming drift. This derives an
// order in which callees come BEFORE callers, so by the time a caller is
// migrated its callees already exist and can be shown to the model as the
// ALREADY-MIGRATED TARGET API.
//
// Client twin of server/core/migration/ordering.py. The order is a stable DFS
// post-order over the "call" dependency edges. It tolerates both client graph
// shapes: the offline analyzer keys nodes/edges by unit NAME, while the backend
// analysis keys them by chunk id - so we match a chunk to a graph key by either.

import type { DependencyGraph, MigrationChunk } from "@/types/legacylift";

/** An edge may carry an edge_type (backend) or nothing (offline). Data-access
 *  edges don't constrain call order. */
function isDataEdge(edge: { label?: string; edge_type?: string }): boolean {
  const kind = (edge.label ?? edge.edge_type ?? "").toLowerCase();
  return kind.includes("data");
}

/** Resolve a graph key (a node id OR a unit name) to a chunk. */
function makeResolver(chunks: MigrationChunk[]): (key: unknown) => MigrationChunk | undefined {
  const byId = new Map<string, MigrationChunk>();
  const byName = new Map<string, MigrationChunk>();
  for (const c of chunks) {
    byId.set(c.id, c);
    byName.set(c.name, c); // last-wins on name collision (rare)
  }
  return (key) => {
    if (typeof key !== "string") return undefined;
    return byId.get(key) ?? byName.get(key);
  };
}

/**
 * Build `deps`: for each chunk id, the set of chunk ids it directly depends on
 * (its callees). Works across both client graph shapes.
 */
export function buildDependencyMap(
  chunks: MigrationChunk[],
  graph: DependencyGraph | null,
): Map<string, Set<string>> {
  const resolve = makeResolver(chunks);
  const deps = new Map<string, Set<string>>();
  for (const c of chunks) deps.set(c.id, new Set());

  for (const edge of graph?.edges ?? []) {
    if (isDataEdge(edge as { label?: string; edge_type?: string })) continue;
    const src = resolve(edge.source);
    const tgt = resolve(edge.target);
    if (src && tgt && src.id !== tgt.id) {
      deps.get(src.id)!.add(tgt.id);
    }
  }
  return deps;
}

/**
 * Chunk ids in dependency order - callees before callers. Cycles (recursive /
 * mutual PERFORM) are broken deterministically by visitation order; unresolved
 * / external edge targets and data edges are ignored.
 */
export function computeMigrationOrder(
  chunks: MigrationChunk[],
  graph: DependencyGraph | null,
): string[] {
  if (chunks.length === 0) return [];
  const deps = buildDependencyMap(chunks, graph);

  const startById = new Map(chunks.map((c) => [c.id, c.start_line ?? 0]));
  const cmp = (a: string, b: string) =>
    (startById.get(a) ?? 0) - (startById.get(b) ?? 0) || a.localeCompare(b);

  const order: string[] = [];
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of [...(deps.get(id) ?? [])].sort(cmp)) visit(dep);
    order.push(id);
  };

  for (const id of chunks.map((c) => c.id).sort(cmp)) visit(id);
  return order;
}

/** The next chunk to migrate: first not-yet-approved chunk in dependency order. */
export function nextSuggestedChunkId(
  chunks: MigrationChunk[],
  graph: DependencyGraph | null,
): string | null {
  const order = computeMigrationOrder(chunks, graph);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  for (const id of order) {
    if (byId.get(id)?.status !== "Approved") return id;
  }
  return null;
}
