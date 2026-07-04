// lib/manifest.ts - Builds a lightweight, plain-text summary of the rest of
// the file tree (dependency edges + extracted business rules) to give the
// migration LLM cross-file awareness without sending every other file's raw
// content. Pass "" as currentFilename to include every file (used for the
// whole-project review).

import type { PipelineState } from "@/types/legacylift";

export function buildProjectManifest(
  state: Pick<PipelineState, "files" | "dependencyGraph" | "businessRules">,
  currentFilename: string,
): string {
  const allFilenames = new Set<string>();
  for (const f of state.files) allFilenames.add(f.filename);
  for (const n of state.dependencyGraph?.nodes ?? []) {
    if (n.file) allFilenames.add(n.file);
  }
  for (const r of state.businessRules) {
    if (r.source_file) allFilenames.add(r.source_file);
  }

  const otherFiles = [...allFilenames]
    .filter((f) => f && f !== currentFilename)
    .sort();

  if (otherFiles.length === 0) return "";

  const nodeFileById = new Map<string, string>();
  for (const n of state.dependencyGraph?.nodes ?? []) {
    nodeFileById.set(n.id, n.file);
  }

  const lines: string[] = [];
  for (const filename of otherFiles) {
    lines.push(`- ${filename}`);

    const edges = (state.dependencyGraph?.edges ?? []).filter((e) => {
      const sourceFile = nodeFileById.get(e.source);
      const targetFile = nodeFileById.get(e.target);
      return sourceFile === filename || targetFile === filename;
    });
    for (const e of edges.slice(0, 10)) {
      lines.push(`    depends: ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ""}`);
    }

    const rules = state.businessRules.filter((r) => r.source_file === filename);
    for (const r of rules.slice(0, 10)) {
      lines.push(`    rule: ${r.title}`);
    }
  }

  return lines.join("\n");
}
