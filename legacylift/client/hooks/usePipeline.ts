"use client";
// hooks/usePipeline.ts — Full pipeline state manager.
// Subscribes to all WebSocket events for a project and keeps a single
// PipelineState object up to date. Components read from this state via
// context or props — they do NOT connect to WS directly.
//
// TODO: Persist state to sessionStorage so a page refresh doesn't lose progress.
// TODO: Add optimistic UI updates for chunk approve/reject actions.

import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { isDemoProject, createDemoState } from "@/lib/demoData";
import type {
  BusinessRule,
  DependencyGraph,
  MigrationChunk,
  PipelineLayer,
  PipelineState,
  RiskLevel,
  TargetProfile,
} from "@/types/legacylift";

const INITIAL_STATE: PipelineState = {
  projectId: null,
  currentLayer: 0,
  businessRules: [],
  dependencyGraph: null,
  riskScores: {},
  targetProfile: null,
  currentChunk: null,
  chunks: [],
  migrationComplete: false,
  error: null,
};

interface UsePipelineReturn {
  state: PipelineState;
  wsStatus: ReturnType<typeof useWebSocket>["status"];
  /** Call after approving a chunk in the UI to optimistically update local state. */
  markChunkApproved: (chunkId: string) => void;
  /** Call after rejecting a chunk in the UI. */
  markChunkRejected: (chunkId: string) => void;
  /** Update a business rule's status after human review. */
  updateRule: (ruleId: string, patch: Partial<BusinessRule>) => void;
  /** Jump to a pipeline layer (used for navigation in demo mode). */
  selectLayer: (layer: PipelineLayer) => void;
  /** Promote the next pending chunk to review, or complete (demo mode). */
  advanceDemoChunk: () => void;
}

export function usePipeline(projectId: string | null): UsePipelineReturn {
  const demo = isDemoProject(projectId);
  // In demo mode we don't open a real socket — the state is fully seeded.
  const { status: wsStatus, subscribe } = useWebSocket(demo ? null : projectId);
  const [state, setState] = useState<PipelineState>(() =>
    demo && projectId
      ? createDemoState(projectId)
      : { ...INITIAL_STATE, projectId },
  );

  // Reset when project changes
  useEffect(() => {
    setState(
      demo && projectId
        ? createDemoState(projectId)
        : { ...INITIAL_STATE, projectId },
    );
  }, [projectId, demo]);

  const setLayer = useCallback((layer: PipelineLayer) => {
    setState((prev) => ({ ...prev, currentLayer: layer }));
  }, []);

  // ------------------------------------------------------------------
  // Subscribe to all WebSocket events
  // ------------------------------------------------------------------

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      subscribe("archaeology_started", () => {
        setLayer(0);
      }),
    );

    unsubs.push(
      subscribe("archaeology_complete", () => {
        // Layer 0 complete — stay on layer 0 until rules are reviewed
      }),
    );

    unsubs.push(
      subscribe("business_rule_found", (e) => {
        setState((prev) => ({
          ...prev,
          businessRules: [...prev.businessRules, e.rule],
        }));
      }),
    );

    unsubs.push(
      subscribe("dependency_graph_ready", (e) => {
        setState((prev) => ({
          ...prev,
          dependencyGraph: e.graph as unknown as DependencyGraph,
        }));
      }),
    );

    unsubs.push(
      subscribe("risk_scores_ready", (e) => {
        setState((prev) => ({ ...prev, riskScores: e.scores }));
      }),
    );

    unsubs.push(
      subscribe("target_profile_ready", (e) => {
        setState((prev) => ({
          ...prev,
          currentLayer: 0.5,
          targetProfile: e.profile as unknown as TargetProfile,
        }));
      }),
    );

    unsubs.push(
      subscribe("chunk_started", (e) => {
        const newChunk: MigrationChunk = {
          id: e.chunk_id,
          name: e.name,
          source_code: "",
          migrated_code: "",
          diff: "",
          risk_level: "Medium" as RiskLevel,
          status: "Running",
          retry_count: 0,
          test_results: [],
          static_analysis: null,
          ai_review: null,
        };
        setState((prev) => ({
          ...prev,
          currentLayer: 1,
          currentChunk: newChunk,
          chunks: [...prev.chunks.filter((c) => c.id !== e.chunk_id), newChunk],
        }));
      }),
    );

    unsubs.push(
      subscribe("static_analysis_complete", (e) => {
        setState((prev) => {
          if (!prev.currentChunk) return prev;
          const updated: MigrationChunk = {
            ...prev.currentChunk,
            static_analysis: {
              passed: e.passed,
              issues: e.issues,
              complexity_score: 0,
              line_count: 0,
            },
          };
          return {
            ...prev,
            currentLayer: 1,
            currentChunk: updated,
            chunks: prev.chunks.map((c) => (c.id === updated.id ? updated : c)),
          };
        });
      }),
    );

    unsubs.push(
      subscribe("ai_review_complete", (e) => {
        setState((prev) => {
          if (!prev.currentChunk) return prev;
          const updated: MigrationChunk = {
            ...prev.currentChunk,
            ai_review: {
              issues_found: e.issues_found,
              critical_issues: [],
              warnings: [],
              suggestions: [],
              ai_confidence: "Medium",
              raw_response: "",
            },
          };
          return {
            ...prev,
            currentLayer: 2,
            currentChunk: updated,
            chunks: prev.chunks.map((c) => (c.id === updated.id ? updated : c)),
          };
        });
      }),
    );

    unsubs.push(
      subscribe("test_result", (e) => {
        setState((prev) => {
          if (!prev.currentChunk) return prev;
          const updated: MigrationChunk = {
            ...prev.currentChunk,
            test_results: [
              ...prev.currentChunk.test_results,
              { name: e.name, passed: e.passed, error_message: null, duration_ms: 0 },
            ],
          };
          return {
            ...prev,
            currentLayer: 3,
            currentChunk: updated,
            chunks: prev.chunks.map((c) => (c.id === updated.id ? updated : c)),
          };
        });
      }),
    );

    unsubs.push(
      subscribe("chunk_ready_for_approval", (e) => {
        setState((prev) => {
          const updated: MigrationChunk = {
            ...(prev.chunks.find((c) => c.id === e.chunk_id) ?? prev.currentChunk!),
            diff: e.diff,
            status: "Review",
          };
          return {
            ...prev,
            currentChunk: updated,
            chunks: prev.chunks.map((c) => (c.id === updated.id ? updated : c)),
          };
        });
      }),
    );

    unsubs.push(
      subscribe("chunk_approved", (e) => {
        setState((prev) => ({
          ...prev,
          chunks: prev.chunks.map((c) =>
            c.id === e.chunk_id ? { ...c, status: "Approved" } : c,
          ),
        }));
      }),
    );

    unsubs.push(
      subscribe("migration_complete", () => {
        setState((prev) => ({
          ...prev,
          currentLayer: 4,
          migrationComplete: true,
        }));
      }),
    );

    unsubs.push(
      subscribe("error", (e) => {
        setState((prev) => ({ ...prev, error: e.message }));
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [subscribe, setLayer]);

  // ------------------------------------------------------------------
  // Optimistic UI helpers
  // ------------------------------------------------------------------

  const markChunkApproved = useCallback((chunkId: string) => {
    setState((prev) => ({
      ...prev,
      chunks: prev.chunks.map((c) =>
        c.id === chunkId ? { ...c, status: "Approved" } : c,
      ),
    }));
  }, []);

  const markChunkRejected = useCallback((chunkId: string) => {
    setState((prev) => ({
      ...prev,
      chunks: prev.chunks.map((c) =>
        c.id === chunkId ? { ...c, status: "Rejected" } : c,
      ),
    }));
  }, []);

  const updateRule = useCallback(
    (ruleId: string, patch: Partial<BusinessRule>) => {
      setState((prev) => ({
        ...prev,
        businessRules: prev.businessRules.map((r) =>
          r.id === ruleId ? { ...r, ...patch } : r,
        ),
      }));
    },
    [],
  );

  // Demo-only: promote the next pending chunk to review, or finish.
  const advanceDemoChunk = useCallback(() => {
    setState((prev) => {
      const next = prev.chunks.find((c) => c.status === "Pending");
      if (!next) {
        return {
          ...prev,
          currentChunk: null,
          currentLayer: 4,
          migrationComplete: true,
        };
      }
      const promoted: MigrationChunk = { ...next, status: "Review" };
      return {
        ...prev,
        currentLayer: 1,
        currentChunk: promoted,
        chunks: prev.chunks.map((c) => (c.id === promoted.id ? promoted : c)),
      };
    });
  }, []);

  return {
    state,
    wsStatus: demo ? "connected" : wsStatus,
    markChunkApproved,
    markChunkRejected,
    updateRule,
    selectLayer: setLayer,
    advanceDemoChunk,
  };
}
