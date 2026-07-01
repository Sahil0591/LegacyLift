// lib/download.ts — export the migrated code from the workbench.
// Bundles every generated unit into a single annotated Python file and triggers
// a browser download. (Single file keeps it dependency-free; swap for a zip if
// you want the original folder structure.)

import type { MigrationChunk } from "@/types/legacylift";

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
}

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

function fallbackDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadMigration(
  projectName: string,
  chunks: MigrationChunk[],
): Promise<void> {
  const text = buildMigratedFile(projectName, chunks);
  const safe = projectName.replace(/[^\w.-]+/g, "_") || "migration";
  const filename = `${safe}_migrated.py`;
  const blob = new Blob([text], { type: "text/x-python;charset=utf-8" });

  const savePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (!savePicker) {
    fallbackDownload(blob, filename);
    return;
  }

  try {
    const handle = await savePicker({
      suggestedName: filename,
      types: [
        {
          description: "Python file",
          accept: { "text/x-python": [".py"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    fallbackDownload(blob, filename);
  }
}
