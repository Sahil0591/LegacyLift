// lib/startMigration.ts - The one entry point into a migration: analyze a
// public repo (or uploaded files) and land the caller on a workbench project.
//
// Shared by the landing-page hero and the /demo page so there's a single flow:
// POST /api/analyze → persist to the DB (owner-scoped) → open the workbench,
// falling back to browser localStorage if the backend/DB is unavailable so the
// workbench still opens.

import type { AnalyzeResult } from "@/lib/analyze";
import { importAnalysis } from "@/lib/api";
import { emptyConfig } from "@/lib/projectConfig";
import { saveConfig, storeAnalysis } from "@/lib/projectStore";
import { DEFAULT_TARGET_ID } from "@/lib/targetLanguages";
import type { ProjectLanguage } from "@/types/legacylift";

/** A real, public COBOL repo used as the prefilled example everywhere. */
export const SAMPLE_REPO =
  "github.com/aws-samples/aws-mainframe-modernization-carddemo";

/** Fixed, non-editable prefix rendered before the editable repo path. */
export const REPO_PREFIX = "github.com/";

/**
 * Strip any leading github.com/ (with optional scheme/www) so a repo input only
 * ever holds the editable "org/repo" path. Pairs with REPO_PREFIX in the UI.
 */
export function stripRepoPrefix(url: string): string {
  return url.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "");
}

export interface StartMigrationOptions {
  repoUrl?: string;
  files?: { filename: string; content: string }[];
  /** Legacy source language of the codebase (default COBOL). */
  sourceLanguage?: ProjectLanguage;
  /** Default target-language id for the project (default Python). */
  targetId?: string;
}

/**
 * Analyze a repo/files and return the workbench project id to navigate to.
 * Throws on analysis failure (invalid repo, no code units) so the caller can
 * show the message; DB failures are swallowed via the localStorage fallback.
 */
export async function startMigration(
  opts: StartMigrationOptions,
): Promise<string> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl: opts.repoUrl, files: opts.files }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Analysis failed");
  const analysis = data as AnalyzeResult;

  // Seed the workbench config with the chosen target as the project default
  // (per-file overrides come later on the Overview).
  const cfg = emptyConfig(opts.targetId ?? DEFAULT_TARGET_ID);

  try {
    const created = await importAnalysis(
      analysis,
      opts.sourceLanguage ?? "COBOL",
      cfg,
    );
    return created.project_id;
  } catch {
    const id = storeAnalysis(analysis);
    saveConfig(id, cfg);
    return id;
  }
}
