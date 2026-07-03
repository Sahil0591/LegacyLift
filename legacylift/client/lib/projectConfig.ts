// lib/projectConfig.ts — Human-authored, per-project workbench configuration.
//
// Holds the two things a reviewer configures on the Overview that steer every
// migration:
//   1. context — institutional instructions the AI can't infer from source
//      (systems, copybooks, regulatory caps, naming conventions, target
//      architecture), project-wide and per file.
//   2. targets — which language each file migrates INTO (a project default plus
//      per-file overrides).
//
// One blob, one persistence key / DB field. Mirrors the localStorage/DB/demo
// persistence used for `lessons` and `finalizedFiles`.

import {
  DEFAULT_TARGET_ID,
  getTargetLanguage,
  type TargetLanguage,
} from "@/lib/targetLanguages";

export interface ProjectContextConfig {
  /** Applies to every file in the project. */
  global: string;
  /** filename -> file-specific context. */
  perFile: Record<string, string>;
}

export interface ProjectTargetsConfig {
  /** TargetLanguage id used for files without an override. */
  default: string;
  /** filename -> TargetLanguage id override. */
  perFile: Record<string, string>;
}

export interface ProjectConfig {
  context: ProjectContextConfig;
  targets: ProjectTargetsConfig;
}

export function emptyConfig(defaultTargetId: string = DEFAULT_TARGET_ID): ProjectConfig {
  return {
    context: { global: "", perFile: {} },
    targets: { default: defaultTargetId || DEFAULT_TARGET_ID, perFile: {} },
  };
}

/** Defensively coerce an unknown (stored / server) blob into a valid config. */
export function normalizeConfig(raw: unknown): ProjectConfig {
  const base = emptyConfig();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;

  const ctx = (r.context as Record<string, unknown>) ?? {};
  const tgt = (r.targets as Record<string, unknown>) ?? {};

  const asStringMap = (v: unknown): Record<string, string> => {
    if (!v || typeof v !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") out[k] = val;
    }
    return out;
  };

  return {
    context: {
      global: typeof ctx.global === "string" ? ctx.global : "",
      perFile: asStringMap(ctx.perFile),
    },
    targets: {
      default:
        typeof tgt.default === "string" && tgt.default ? tgt.default : DEFAULT_TARGET_ID,
      perFile: asStringMap(tgt.perFile),
    },
  };
}

/** The target-language id a file will migrate into (override ?? default). */
export function resolveTargetId(config: ProjectConfig, filename: string): string {
  return (
    (filename && config.targets.perFile[filename]) ||
    config.targets.default ||
    DEFAULT_TARGET_ID
  );
}

/** The resolved TargetLanguage catalog entry for a file. */
export function resolveTarget(config: ProjectConfig, filename: string): TargetLanguage {
  return getTargetLanguage(resolveTargetId(config, filename));
}

/** True when the file has an explicit per-file target override. */
export function hasTargetOverride(config: ProjectConfig, filename: string): boolean {
  const override = config.targets.perFile[filename];
  return !!override && override !== config.targets.default;
}

/**
 * The combined institutional-context block for one file: project-wide context
 * first, then the file-specific note. Empty string when nothing is authored, so
 * callers can pass it straight through (the prompt omits empty blocks).
 */
export function buildInstitutionalContext(
  config: ProjectConfig,
  filename: string,
): string {
  const parts: string[] = [];
  const global = config.context.global?.trim();
  if (global) parts.push(`Project-wide context (applies to all files):\n${global}`);
  const perFile = filename ? config.context.perFile[filename]?.trim() : "";
  if (perFile) parts.push(`Context specific to ${filename}:\n${perFile}`);
  return parts.join("\n\n");
}

/** Distinct target labels actually in use across the given files (for badges). */
export function summarizeTargets(
  config: ProjectConfig,
  filenames: string[],
): { labels: string[]; ids: string[] } {
  const ids = new Set<string>();
  if (filenames.length === 0) ids.add(resolveTargetId(config, ""));
  for (const f of filenames) ids.add(resolveTargetId(config, f));
  const idList = [...ids];
  return {
    ids: idList,
    labels: idList.map((id) => getTargetLanguage(id).label),
  };
}
