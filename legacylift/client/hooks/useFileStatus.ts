// hooks/useFileStatus.ts - Groups chunks by their source file and derives a
// per-file status (in progress / ready to finalize / finalizing / finalized).
// Finalized is the only piece of state not derivable from chunks alone - it's
// tracked in usePipeline and passed in here. Files are also grouped into
// dependency-graph connected clusters so a file can't finalize until every
// file it's transitively linked to is also ready.

import { useMemo } from "react";
import type { MigrationChunk, PipelineState, RiskLevel } from "@/types/legacylift";
import { RISK_RANK } from "@/components/workbench/shared";
import { computeFileClusters } from "@/lib/fileClusters";
import {
  emptyConfig,
  hasTargetOverride,
  resolveTarget,
  type ProjectConfig,
} from "@/lib/projectConfig";
import type { TargetLanguage } from "@/lib/targetLanguages";

export type FileStatus =
  | "in_progress"
  | "ready_to_finalize"
  | "finalizing"
  | "finalized";

export interface FileGroup {
  filename: string;
  language: string;
  chunks: MigrationChunk[];
  approvedCount: number;
  totalCount: number;
  riskLevel: RiskLevel;
  status: FileStatus;
  /** Other filenames in the same dependency-graph connected cluster. */
  clusterFiles: string[];
  /** True iff every file in this file's cluster has all its chunks approved. */
  clusterReady: boolean;
  /** Cluster-mate filenames not yet ready - surfaced in the disabled-button tooltip. */
  blockedBy: string[];
  /** Resolved target language this file migrates into (override ?? default). */
  target: TargetLanguage;
  /** True when the file has an explicit per-file target override. */
  targetOverridden: boolean;
}

const UNGROUPED = "(ungrouped)";

export function useFileGroups(
  state: Pick<PipelineState, "chunks" | "files" | "dependencyGraph">,
  finalizedFiles: Record<string, true> = {},
  finalizingFile: string | null = null,
  config: ProjectConfig = emptyConfig(),
): FileGroup[] {
  return useMemo(() => {
    const byFile = new Map<string, MigrationChunk[]>();
    for (const c of state.chunks) {
      const key = c.source_file || UNGROUPED;
      const list = byFile.get(key) ?? [];
      list.push(c);
      byFile.set(key, list);
    }

    const languageByFile = new Map(state.files.map((f) => [f.filename, f.language]));
    const clusters = computeFileClusters(state.dependencyGraph);

    // A file is "ready" once every chunk in it is approved (finalized also counts).
    const readyByFile = new Map<string, boolean>();
    for (const [filename, chunks] of byFile.entries()) {
      readyByFile.set(
        filename,
        chunks.length > 0 && chunks.every((c) => c.status === "Approved"),
      );
    }

    return [...byFile.entries()].map(([filename, chunks]) => {
      const approvedCount = chunks.filter((c) => c.status === "Approved").length;
      const totalCount = chunks.length;
      const riskLevel = chunks.reduce<RiskLevel>(
        (worst, c) => (RISK_RANK[c.risk_level] > RISK_RANK[worst] ? c.risk_level : worst),
        "Low",
      );

      let status: FileStatus;
      if (finalizedFiles[filename]) status = "finalized";
      else if (finalizingFile === filename) status = "finalizing";
      else if (totalCount > 0 && approvedCount === totalCount) status = "ready_to_finalize";
      else status = "in_progress";

      const clusterFiles = [...(clusters.get(filename) ?? [])];
      const blockedBy = clusterFiles.filter((f) => !(readyByFile.get(f) ?? true));
      const clusterReady = blockedBy.length === 0;

      return {
        filename,
        language: languageByFile.get(filename) ?? "",
        chunks,
        approvedCount,
        totalCount,
        riskLevel,
        status,
        clusterFiles,
        clusterReady,
        blockedBy,
        target: resolveTarget(config, filename),
        targetOverridden: hasTargetOverride(config, filename),
      };
    });
  }, [state.chunks, state.files, state.dependencyGraph, finalizedFiles, finalizingFile, config]);
}
