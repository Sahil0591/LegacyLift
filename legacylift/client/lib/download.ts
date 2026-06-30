// lib/download.ts — export the migrated code from the workbench.
// Bundles every generated unit into a single annotated Python file and triggers
// a browser download. (Single file keeps it dependency-free; swap for a zip if
// you want the original folder structure.)

import type { MigrationChunk } from "@/types/legacylift";

export function buildMigratedFile(
  projectName: string,
  chunks: MigrationChunk[],
): string {
  const done = chunks.filter((c) => c.migrated_code && c.migrated_code.trim());
  const bar = "#".repeat(64);
  const header = [
    bar,
    `# Migrated by LegacyLift — ${projectName}`,
    `# ${done.length} of ${chunks.length} units generated.`,
    `# Generated code is a starting point — review every unit before use.`,
    bar,
    "",
    "from decimal import Decimal, ROUND_HALF_UP  # noqa: F401",
    "",
    "",
  ].join("\n");

  const body = done
    .map((c) =>
      [
        bar,
        `# ${c.name}   (risk: ${c.risk_level} · status: ${c.status})`,
        bar,
        c.migrated_code.trim(),
      ].join("\n"),
    )
    .join("\n\n\n");

  return header + body + "\n";
}

export function downloadMigration(
  projectName: string,
  chunks: MigrationChunk[],
): void {
  const text = buildMigratedFile(projectName, chunks);
  const safe = projectName.replace(/[^\w.-]+/g, "_") || "migration";
  const blob = new Blob([text], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}_migrated.py`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
