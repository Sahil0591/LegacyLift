// lib/download.ts — export the migrated code from the workbench.
// Bundles every generated unit into a single annotated Python file and triggers
// a browser download. (Single file keeps it dependency-free; swap for a zip if
// you want the original folder structure.)

import JSZip from "jszip";
import type { MigrationChunk } from "@/types/legacylift";
import type { FileGroup } from "@/hooks/useFileStatus";
import { assembleFile } from "@/lib/fileAssembly";

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
}

/** 'interest.cbl' -> 'interest.py'; 'AccountService.java' -> 'AccountService.py'. */
export function toPythonFilename(originalName: string): string {
  const stripped = originalName.replace(/\.[^./\\]+$/, "");
  return `${stripped}.py`;
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

/** Shared save-picker-or-blob-fallback path used by every download helper. */
async function saveBlob(
  blob: Blob,
  filename: string,
  pickerType?: { description: string; accept: Record<string, string[]> },
): Promise<void> {
  const savePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (!savePicker) {
    fallbackDownload(blob, filename);
    return;
  }

  try {
    const handle = await savePicker({
      suggestedName: filename,
      types: pickerType ? [pickerType] : undefined,
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

export async function downloadMigration(
  projectName: string,
  chunks: MigrationChunk[],
): Promise<void> {
  const text = buildMigratedFile(projectName, chunks);
  const safe = projectName.replace(/[^\w.-]+/g, "_") || "migration";
  const filename = `${safe}_migrated.py`;
  const blob = new Blob([text], { type: "text/x-python;charset=utf-8" });
  await saveBlob(blob, filename, {
    description: "Python file",
    accept: { "text/x-python": [".py"] },
  });
}

/** Download one finalized file's assembled Python module on its own. */
export async function downloadSingleFile(fileGroup: FileGroup): Promise<void> {
  const content = assembleFile(fileGroup.filename, fileGroup.chunks);
  const filename = toPythonFilename(fileGroup.filename);
  const blob = new Blob([content], { type: "text/x-python;charset=utf-8" });
  await saveBlob(blob, filename, {
    description: "Python file",
    accept: { "text/x-python": [".py"] },
  });
}

/** Bundle every finalized file into one zip, preserving original filenames. */
export async function downloadProjectZip(
  projectName: string,
  fileGroups: FileGroup[],
): Promise<void> {
  const zip = new JSZip();
  const finalized = fileGroups.filter((f) => f.status === "finalized");

  const approved = finalized.reduce((n, f) => n + f.approvedCount, 0);
  const total = finalized.reduce((n, f) => n + f.totalCount, 0);
  zip.file(
    "_MIGRATION_SUMMARY.txt",
    [
      `Migrated by LegacyLift — ${projectName}`,
      `${finalized.length} file(s) finalized · ${approved}/${total} units approved.`,
      "Generated code is a starting point — review every unit before use.",
      "",
    ].join("\n"),
  );

  for (const fg of finalized) {
    zip.file(toPythonFilename(fg.filename), assembleFile(fg.filename, fg.chunks));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const safe = projectName.replace(/[^\w.-]+/g, "_") || "migration";
  await saveBlob(blob, `${safe}_migrated.zip`);
}
