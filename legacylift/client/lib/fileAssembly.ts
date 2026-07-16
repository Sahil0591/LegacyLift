// lib/fileAssembly.ts - Deterministically reassemble one source file's
// approved chunks into a single migrated module, in original line order, in the
// file's chosen target language. Imports declared inside the individual chunks
// are hoisted, de-duplicated, and emitted once at the top so the result is a
// structurally valid module rather than a bag of chunks with the same import
// repeated after every unit. Used by the per-file finalize flow and by the
// download helpers.

import type { MigrationChunk } from "@/types/legacylift";
import type { TargetLanguage } from "@/lib/targetLanguages";
import { hoistImports } from "@/lib/imports";

const RULE = "=".repeat(60);

/** A comment line in the target language ("# ...", "// ...", "-- ..."). */
function comment(target: TargetLanguage, text = ""): string {
  return text ? `${target.commentPrefix} ${text}` : target.commentPrefix;
}

/** Imports the target mandates regardless of what the chunks declared, merged
 *  into the hoisted import block (e.g. Python's Decimal money policy). */
function mandatedImports(target: TargetLanguage): string[] {
  if (target.language === "Python") {
    return ["from decimal import Decimal, ROUND_HALF_UP"];
  }
  return [];
}

/** Concatenate every migrated chunk for one file into a single module. */
export function assembleFile(
  filename: string,
  chunks: MigrationChunk[],
  target: TargetLanguage,
): string {
  const ordered = [...chunks].sort((a, b) => a.start_line - b.start_line);

  const { headerDecls, imports, bodies } = hoistImports(
    target.language,
    ordered.map((c) => c.migrated_code.trim()),
    mandatedImports(target),
  );

  const header = [
    comment(target, RULE),
    comment(target, `${filename} - migrated by LegacyLift → ${target.label}`),
    comment(
      target,
      `${ordered.length} unit${ordered.length === 1 ? "" : "s"} assembled from approved chunks.`,
    ),
    comment(target, RULE),
  ].join("\n");

  const preamble = [...headerDecls, ...imports].join("\n");

  const body = ordered
    .map((c, i) =>
      [
        comment(target, RULE),
        comment(target, `${c.name}   (risk: ${c.risk_level} · status: ${c.status})`),
        comment(target, RULE),
        bodies[i],
      ].join("\n"),
    )
    .join("\n\n\n");

  return [header, preamble, body].filter(Boolean).join("\n\n\n") + "\n";
}

/** The original (legacy) source of a file, reconstructed from its chunks. */
export function concatenateSource(chunks: MigrationChunk[]): string {
  return [...chunks]
    .sort((a, b) => a.start_line - b.start_line)
    .map((c) => c.source_code)
    .join("\n\n");
}
