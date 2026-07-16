// lib/projectStore.ts - Persistent local project storage via localStorage.
// Projects survive page refreshes and browser restarts (unlike sessionStorage).
//
// Two layers:
//   1. Lightweight index (legacylift:project-index) - list of metadata cards
//      for the /projects dashboard. Small; always in sync.
//   2. Full analysis blob (legacylift:analysis:<id>) - the complete AnalyzeResult
//      consumed by the workbench. Large; loaded on demand.

import type { AnalyzeResult } from "@/lib/analyze";
import type { Lesson } from "@/lib/lessons";
import { normalizeConfig, type ProjectConfig } from "@/lib/projectConfig";
import type {
  AIReviewResult,
  StaticAnalysisResult,
  TestResult,
} from "@/types/legacylift";

const ANALYSIS_PREFIX = "legacylift:analysis:";
const PROGRESS_PREFIX = "legacylift:progress:";
const FILE_STATUS_PREFIX = "legacylift:filestatus:";
const RECONCILED_PREFIX = "legacylift:reconciled:";
const LESSONS_PREFIX = "legacylift:lessons:";
const CONFIG_PREFIX = "legacylift:config:";
const INDEX_KEY = "legacylift:project-index";

export interface ProjectIndexEntry {
  id: string;
  name: string;
  source: string;
  language: string;
  chunksTotal: number;
  chunksApproved: number;
  status: "ready" | "in_progress" | "complete";
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

function readIndex(): ProjectIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as ProjectIndexEntry[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: ProjectIndexEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // localStorage quota exceeded - best-effort
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Store a completed analysis result and add it to the project index. */
export function storeAnalysis(result: AnalyzeResult): string {
  const id = `local-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  try {
    localStorage.setItem(ANALYSIS_PREFIX + id, JSON.stringify(result));
  } catch {
    // If storage is full, return the id anyway - workbench shows empty state.
    return id;
  }

  const entry: ProjectIndexEntry = {
    id,
    name: result.projectName,
    source: result.source,
    language: _detectLanguage(result),
    chunksTotal: result.chunks.length,
    chunksApproved: 0,
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Prepend so newest appears first; deduplicate by id (shouldn't happen but safe).
  const index = readIndex().filter((e) => e.id !== id);
  writeIndex([entry, ...index]);

  return id;
}

/** Load the full analysis blob for a project. Returns null if not found. */
export function loadAnalysis(projectId: string): AnalyzeResult | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_PREFIX + projectId);
    return raw ? (JSON.parse(raw) as AnalyzeResult) : null;
  } catch {
    return null;
  }
}

/** Return all projects in reverse-chronological order (newest first). */
export function listProjects(): ProjectIndexEntry[] {
  return readIndex();
}

/** Update progress counters on an existing project card. */
export function updateProjectProgress(
  id: string,
  patch: Partial<Pick<ProjectIndexEntry, "chunksApproved" | "status">>,
): void {
  const index = readIndex();
  const entry = index.find((e) => e.id === id);
  if (!entry) return;
  Object.assign(entry, patch, { updatedAt: new Date().toISOString() });
  writeIndex(index);
}

/** Remove a project from the index and delete its stored analysis and progress. */
export function deleteProject(id: string): void {
  try {
    localStorage.removeItem(ANALYSIS_PREFIX + id);
    localStorage.removeItem(PROGRESS_PREFIX + id);
    localStorage.removeItem(FILE_STATUS_PREFIX + id);
    localStorage.removeItem(RECONCILED_PREFIX + id);
    localStorage.removeItem(LESSONS_PREFIX + id);
    localStorage.removeItem(CONFIG_PREFIX + id);
  } catch {}
  writeIndex(readIndex().filter((e) => e.id !== id));
}

// ---------------------------------------------------------------------------
// Chunk progress (persisted separately so the full analysis blob stays clean)
// ---------------------------------------------------------------------------

/** Saved per-chunk fields - just the parts that change during review. */
export interface ChunkProgressEntry {
  status: string;
  migrated_code: string;
  // Checks-panel results - without these, a refresh mid-review wipes static
  // analysis/AI review/test results and forces re-running checks from scratch.
  static_analysis: StaticAnalysisResult | null;
  ai_review: AIReviewResult | null;
  test_results: TestResult[];
}

/**
 * Persist current chunk statuses for a local project so they survive a page
 * refresh.  Called automatically by usePipeline after every state change.
 */
export function saveProgress(
  projectId: string,
  chunks: Array<{
    id: string;
    status: string;
    migrated_code: string;
    static_analysis: StaticAnalysisResult | null;
    ai_review: AIReviewResult | null;
    test_results: TestResult[];
  }>,
): void {
  try {
    const map: Record<string, ChunkProgressEntry> = {};
    for (const c of chunks) {
      map[c.id] = {
        status: c.status,
        migrated_code: c.migrated_code,
        static_analysis: c.static_analysis,
        ai_review: c.ai_review,
        test_results: c.test_results,
      };
    }
    localStorage.setItem(PROGRESS_PREFIX + projectId, JSON.stringify(map));
  } catch {}
}

/** Load previously saved chunk progress.  Returns null when nothing is stored. */
export function loadProgress(
  projectId: string,
): Record<string, ChunkProgressEntry> | null {
  try {
    const raw = localStorage.getItem(PROGRESS_PREFIX + projectId);
    return raw ? (JSON.parse(raw) as Record<string, ChunkProgressEntry>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// File finalization status (local projects only)
// ---------------------------------------------------------------------------

/** Persist which files have been finalized so a refresh doesn't lose it. */
export function saveFileStatus(
  projectId: string,
  statuses: Record<string, true>,
): void {
  try {
    localStorage.setItem(FILE_STATUS_PREFIX + projectId, JSON.stringify(statuses));
  } catch {
    // best-effort
  }
}

/** Load previously finalized files. Returns null when nothing is stored. */
export function loadFileStatus(projectId: string): Record<string, true> | null {
  try {
    const raw = localStorage.getItem(FILE_STATUS_PREFIX + projectId);
    return raw ? (JSON.parse(raw) as Record<string, true>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reconciled files (local projects only) - the AI-finalized module per file,
// stored so download uses the reconciled output instead of re-assembling the
// raw chunks. Keyed by filename.
// ---------------------------------------------------------------------------

/** Persist the AI-reconciled module for each finalized file. */
export function saveReconciled(
  projectId: string,
  reconciled: Record<string, string>,
): void {
  try {
    localStorage.setItem(RECONCILED_PREFIX + projectId, JSON.stringify(reconciled));
  } catch {
    // best-effort (quota) - download falls back to deterministic assembly.
  }
}

/** Load previously reconciled files. Returns null when nothing is stored. */
export function loadReconciled(
  projectId: string,
): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(RECONCILED_PREFIX + projectId);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lessons learned (local projects only) - the feedback loop's memory.
// ---------------------------------------------------------------------------

/** Persist accumulated lessons so a refresh doesn't lose the feedback loop. */
export function saveLessons(projectId: string, lessons: Lesson[]): void {
  try {
    localStorage.setItem(LESSONS_PREFIX + projectId, JSON.stringify(lessons));
  } catch {
    // best-effort
  }
}

/** Load previously captured lessons. Returns null when nothing is stored. */
export function loadLessons(projectId: string): Lesson[] | null {
  try {
    const raw = localStorage.getItem(LESSONS_PREFIX + projectId);
    return raw ? (JSON.parse(raw) as Lesson[]) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Project config (local projects only) - institutional context + per-file
// target languages authored on the Overview.
// ---------------------------------------------------------------------------

/** Persist the workbench config so a refresh keeps context + target choices. */
export function saveConfig(projectId: string, config: ProjectConfig): void {
  try {
    localStorage.setItem(CONFIG_PREFIX + projectId, JSON.stringify(config));
  } catch {
    // best-effort
  }
}

/** Load previously saved config. Returns null when nothing is stored. */
export function loadConfig(projectId: string): ProjectConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_PREFIX + projectId);
    return raw ? normalizeConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _detectLanguage(result: AnalyzeResult): string {
  const src = result.chunks[0]?.source_code ?? "";
  if (/IDENTIFICATION DIVISION|PROCEDURE DIVISION/i.test(src)) return "COBOL";
  if (/public\s+class|import\s+java\./i.test(src)) return "Java";
  if (/Dim\s+\w+\s+As\s+/i.test(src)) return "VB6";
  return "COBOL";
}
