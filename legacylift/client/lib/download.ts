// lib/download.ts - export the migrated code from the workbench.
// Each file is assembled in its own chosen target language (a project can be
// genuinely multi-language), named with that language's extension, and either
// saved individually or bundled into a zip.

import JSZip from "jszip";
import type { MigrationChunk } from "@/types/legacylift";
import type { FileGroup } from "@/hooks/useFileStatus";
import { assembleFile } from "@/lib/fileAssembly";
import {
  DEFAULT_TARGET_ID,
  getTargetLanguage,
  type TargetLanguage,
} from "@/lib/targetLanguages";

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle>;
}

/** 'interest.cbl' -> 'interest.py' (Python); 'ledger.cbl' -> 'ledger.java' (Java). */
export function toTargetFilename(originalName: string, target: TargetLanguage): string {
  const stripped = originalName.replace(/\.[^./\\]+$/, "");
  return `${stripped}${target.extension}`;
}

export function buildMigratedFile(
  projectName: string,
  chunks: MigrationChunk[],
  target: TargetLanguage,
): string {
  const done = chunks.filter((c) => c.migrated_code && c.migrated_code.trim());
  const c = target.commentPrefix;
  const bar = `${c} ${"=".repeat(60)}`;
  const preamble =
    target.language === "Python"
      ? "\nfrom decimal import Decimal, ROUND_HALF_UP  # noqa: F401\n"
      : "";
  const header = [
    bar,
    `${c} Migrated by LegacyLift - ${projectName} → ${target.label}`,
    `${c} ${done.length} of ${chunks.length} units generated.`,
    `${c} Generated code is a starting point - review every unit before use.`,
    bar,
    preamble,
    "",
  ].join("\n");

  const body = done
    .map((chunk) =>
      [
        bar,
        `${c} ${chunk.name}   (risk: ${chunk.risk_level} · status: ${chunk.status})`,
        bar,
        chunk.migrated_code.trim(),
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
  target: TargetLanguage = getTargetLanguage(DEFAULT_TARGET_ID),
): Promise<void> {
  const text = buildMigratedFile(projectName, chunks, target);
  const safe = projectName.replace(/[^\w.-]+/g, "_") || "migration";
  const filename = `${safe}_migrated${target.extension}`;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  await saveBlob(blob, filename, {
    description: `${target.label} file`,
    accept: { "text/plain": [target.extension] },
  });
}

/** Download one finalized file's assembled module in its target language. */
export async function downloadSingleFile(fileGroup: FileGroup): Promise<void> {
  const content = assembleFile(fileGroup.filename, fileGroup.chunks, fileGroup.target);
  const filename = toTargetFilename(fileGroup.filename, fileGroup.target);
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  await saveBlob(blob, filename, {
    description: `${fileGroup.target.label} file`,
    accept: { "text/plain": [fileGroup.target.extension] },
  });
}

/** Bundle every finalized file into one zip; each file keeps its own target
 *  language and extension (a project can be genuinely multi-language). */
export async function downloadProjectZip(
  projectName: string,
  fileGroups: FileGroup[],
): Promise<void> {
  const zip = new JSZip();
  const finalized = fileGroups.filter((f) => f.status === "finalized");

  const approved = finalized.reduce((n, f) => n + f.approvedCount, 0);
  const total = finalized.reduce((n, f) => n + f.totalCount, 0);
  const targetLine = [...new Set(finalized.map((f) => f.target.label))].join(", ");
  zip.file(
    "_MIGRATION_SUMMARY.txt",
    [
      `Migrated by LegacyLift - ${projectName}`,
      `${finalized.length} file(s) finalized · ${approved}/${total} units approved.`,
      targetLine ? `Target language(s): ${targetLine}.` : "",
      "Generated code is a starting point - review every unit before use.",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  for (const fg of finalized) {
    zip.file(
      toTargetFilename(fg.filename, fg.target),
      assembleFile(fg.filename, fg.chunks, fg.target),
    );
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const safe = projectName.replace(/[^\w.-]+/g, "_") || "migration";
  await saveBlob(blob, `${safe}_migrated.zip`);
}
