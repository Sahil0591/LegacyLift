// lib/projectStore.ts — hand an /api/analyze result from the upload page to the
// workbench without a database. Stored in sessionStorage (per-tab) and read by
// usePipeline for "local-*" project ids.

import type { AnalyzeResult } from "@/lib/analyze";

const PREFIX = "legacylift:analysis:";

export function storeAnalysis(result: AnalyzeResult): string {
  const id = `local-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  try {
    sessionStorage.setItem(PREFIX + id, JSON.stringify(result));
  } catch {
    /* quota / unavailable — workbench will show the empty state */
  }
  return id;
}

export function loadAnalysis(projectId: string): AnalyzeResult | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + projectId);
    return raw ? (JSON.parse(raw) as AnalyzeResult) : null;
  } catch {
    return null;
  }
}
