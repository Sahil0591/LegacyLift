// lib/fileAssembly.ts — Deterministically reassemble one source file's
// approved chunks into a single migrated Python module, in original line
// order. Used by the per-file finalize flow and by the download helpers.

import type { MigrationChunk } from "@/types/legacylift";

const BAR = "#".repeat(64);

/** Concatenate every migrated chunk for one file into a single module. */
export function assembleFile(filename: string, chunks: MigrationChunk[]): string {
  const ordered = [...chunks].sort((a, b) => a.start_line - b.start_line);

  const header = [
    BAR,
    `# ${filename} — migrated by LegacyLift`,
    `# ${ordered.length} unit${ordered.length === 1 ? "" : "s"} assembled from approved chunks.`,
    BAR,
    "",
    "from decimal import Decimal, ROUND_HALF_UP  # noqa: F401",
    "",
    "",
  ].join("\n");

  const body = ordered
    .map((c) =>
      [
        BAR,
        `# ${c.name}   (risk: ${c.risk_level} · status: ${c.status})`,
        BAR,
        c.migrated_code.trim(),
      ].join("\n"),
    )
    .join("\n\n\n");

  return header + body + "\n";
}

/** The original (legacy) source of a file, reconstructed from its chunks. */
export function concatenateSource(chunks: MigrationChunk[]): string {
  return [...chunks]
    .sort((a, b) => a.start_line - b.start_line)
    .map((c) => c.source_code)
    .join("\n\n");
}
