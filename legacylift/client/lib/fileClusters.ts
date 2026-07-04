// lib/fileClusters.ts - Groups files into connected components via the
// dependency graph, so finalizing a file can be gated on every file it's
// transitively linked to also being ready (not just direct neighbors).

import type { DependencyGraph } from "@/types/legacylift";

/** filename -> set of every other filename in its transitive dependency cluster. */
export function computeFileClusters(
  graph: DependencyGraph | null | undefined,
): Map<string, Set<string>> {
  const clusters = new Map<string, Set<string>>();
  if (!graph) return clusters;

  const fileByNodeId = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.file) fileByNodeId.set(n.id, n.file);
  }

  // Undirected adjacency between files (an edge between nodes in different
  // files links those two files; edges within the same file are irrelevant).
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (const e of graph.edges) {
    const sourceFile = fileByNodeId.get(e.source);
    const targetFile = fileByNodeId.get(e.target);
    if (sourceFile && targetFile) link(sourceFile, targetFile);
  }

  const allFiles = new Set(fileByNodeId.values());
  const visited = new Set<string>();

  for (const start of allFiles) {
    if (visited.has(start)) continue;
    const component = new Set<string>();
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.add(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    for (const file of component) {
      clusters.set(file, new Set([...component].filter((f) => f !== file)));
    }
  }

  return clusters;
}
