"use client";
// hooks/usePipeline.ts — Full pipeline state manager.
// Subscribes to all WebSocket events for a project and keeps a single
// PipelineState object up to date. Components read from this state via
// context or props — they do NOT connect to WS directly.
//
// TODO: Persist state to sessionStorage so a page refresh doesn't lose progress.
// TODO: Add optimistic UI updates for chunk approve/reject actions.

import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { isDemoProject, createDemoState } from "@/lib/demoData";
import {
  loadAnalysis,
  loadFileStatus,
  loadLessons,
  loadProgress,
  saveFileStatus,
  saveLessons,
  saveProgress,
  updateProjectProgress,
} from "@/lib/projectStore";
import type { AnalyzeResult } from "@/lib/analyze";
import type { Lesson } from "@/lib/lessons";
import type {
  BusinessRule,
  ApprovalState,
  DependencyGraph,
  MigrationChunk,
  OwnershipAuditEntry,
  OwnershipReviewState,
  PipelineLayer,
  PipelineState,
  ProjectFile,
  RiskLevel,
  RuleConfidence,
  TargetProfile,
} from "@/types/legacylift";
import { addProjectLesson, getProjectFiles, getProjectLessons } from "@/lib/api";

const INITIAL_STATE: PipelineState = {
  projectId: null,
  currentLayer: 0,
  businessRules: [],
  dependencyGraph: null,
  riskScores: {},
  targetProfile: null,
  currentChunk: null,
  chunks: [],
  files: [],
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
  /** Patch a chunk's fields (migrated_code, ai_review, status, …). */
  patchChunk: (chunkId: string, patch: Partial<MigrationChunk>) => void;
  /** Filenames the human has explicitly finalized (assembled + checked). */
  finalizedFiles: Record<string, true>;
  /** Mark a file as finalized; persisted for local projects. */
  markFileFinalized: (filename: string) => void;
  /** Clear a file's finalized flag — used when a chunk inside it is reopened. */
  unmarkFileFinalized: (filename: string) => void;
  /** Accumulated feedback (rejections + review findings) fed into future prompts. */
  lessons: Lesson[];
  /** Record a new lesson; persisted for local projects. */
  addLesson: (lesson: Lesson) => void;
}

function stateFromAnalysis(
  projectId: string,
  a: AnalyzeResult,
): PipelineState {
  // File order, then position within the file — mirrors reading the source
  // top to bottom instead of jumping around by severity.
  const chunks = [...a.chunks].sort(
    (x, y) =>
      x.source_file.localeCompare(y.source_file) || x.start_line - y.start_line,
  );
  return {
    projectId,
    currentLayer: 0,
    businessRules: a.businessRules,
    dependencyGraph: a.dependencyGraph,
    riskScores: a.riskScores,
    targetProfile: a.targetProfile,
    currentChunk: chunks[0] ?? null,
    chunks,
    files: a.files ?? [],
    migrationComplete: false,
    error: null,
  };
}

function confidenceFromNumber(value: unknown): RuleConfidence {
  if (typeof value !== "number") return "Medium";
  if (value >= 0.8) return "High";
  if (value >= 0.5) return "Medium";
  return "Low";
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return (
    value === "Low" ||
    value === "Medium" ||
    value === "High" ||
    value === "Critical"
  );
}

function reviewStateFromRaw(value: unknown): OwnershipReviewState {
  return value === "Confirmed" ||
    value === "Reassigned" ||
    value === "Flagged" ||
    value === "Inferred"
    ? value
    : "Inferred";
}

function approvalStateFromRaw(value: unknown): ApprovalState {
  return value === "Approval requested" ||
    value === "Approved" ||
    value === "Waived" ||
    value === "Approval needed"
    ? value
    : "Approval needed";
}

function normalizeBusinessRule(raw: unknown): BusinessRule {
  const r = raw as Record<string, unknown>;
  const chunkId = typeof r.chunk_id === "string" ? r.chunk_id : undefined;
  const title =
    typeof r.title === "string"
      ? r.title
      : typeof r.rule === "string"
        ? r.rule.split(/[.!?]/)[0] || "Business rule"
        : "Business rule";
  const description =
    typeof r.description === "string"
      ? r.description
      : typeof r.rule === "string"
        ? r.rule
        : "Business rule requires review.";
  const startLine = typeof r.start_line === "number" ? r.start_line : 1;
  const endLine = typeof r.end_line === "number" ? r.end_line : startLine;

  return {
    id: typeof r.id === "string" ? r.id : `rule-${chunkId ?? title}`,
    chunk_id: chunkId,
    title,
    description,
    source_file:
      typeof r.source_file === "string"
        ? r.source_file
        : typeof r.filename === "string"
          ? r.filename
          : "",
    source_lines: [startLine, endLine],
    confidence:
      typeof r.confidence === "string"
        ? (r.confidence as RuleConfidence)
        : confidenceFromNumber(r.confidence),
    hardcoded_values: Array.isArray(r.hardcoded_values)
      ? r.hardcoded_values.filter((v): v is string => typeof v === "string")
      : [],
    warnings: Array.isArray(r.warnings)
      ? r.warnings.filter((v): v is string => typeof v === "string")
      : [],
    status: "Pending",
    ownership_category:
      typeof r.ownership_category === "string"
        ? (r.ownership_category as BusinessRule["ownership_category"])
        : typeof r.owner === "string"
          ? (r.owner as BusinessRule["ownership_category"])
          : "Unknown",
    ownership_evidence:
      typeof r.ownership_evidence === "string"
        ? r.ownership_evidence
        : typeof r.owner_reasoning === "string"
          ? r.owner_reasoning
          : "Inferred by backend Layer 0.",
    ownership_confidence: "Low",
    ownership_detail: null,
    original_inferred_owner:
      typeof r.original_owner === "string"
        ? (r.original_owner as BusinessRule["ownership_category"])
        : typeof r.original_inferred_owner === "string"
          ? (r.original_inferred_owner as BusinessRule["ownership_category"])
          : undefined,
    current_owner:
      typeof r.current_owner === "string"
        ? (r.current_owner as BusinessRule["ownership_category"])
        : undefined,
    review_state: reviewStateFromRaw(r.review_state ?? r.review_status),
    approval_state: approvalStateFromRaw(r.approval_state ?? r.approval_status),
    change_guidance:
      r.change_guidance && typeof r.change_guidance === "object"
        ? (r.change_guidance as BusinessRule["change_guidance"])
        : null,
    audit_trail: Array.isArray(r.audit_trail)
      ? (r.audit_trail as OwnershipAuditEntry[])
      : [],
  };
}

function normalizeGraph(raw: unknown): DependencyGraph {
  const g = raw as { nodes?: unknown[]; edges?: unknown[] };
  return {
    nodes: (g.nodes ?? []).map((node) => {
      const n = node as Record<string, unknown>;
      return {
        id: String(n.id ?? n.label ?? "unknown"),
        label: String(n.label ?? n.id ?? "unknown"),
        file: String(n.file ?? n.filename ?? ""),
        type:
          n.type === "section" ||
          n.type === "paragraph" ||
          n.type === "copybook" ||
          n.type === "external"
            ? n.type
            : "paragraph",
      };
    }),
    edges: (g.edges ?? []).map((edge) => {
      const e = edge as Record<string, unknown>;
      return {
        source: String(e.source ?? ""),
        target: String(e.target ?? ""),
        label:
          typeof e.label === "string"
            ? e.label
            : typeof e.edge_type === "string"
              ? e.edge_type
              : undefined,
      };
    }),
  };
}

function chunkFromGraphNode(node: Record<string, unknown>): MigrationChunk {
  return {
    id: String(node.id ?? node.label ?? "unknown"),
    name: String(node.label ?? node.id ?? "unknown"),
    source_file: String(node.file ?? node.filename ?? ""),
    start_line: 0,
    end_line: 0,
    source_code: "",
    migrated_code: "",
    diff: "",
    risk_level: isRiskLevel(node.risk_level) ? node.risk_level : "Medium",
    status: "Pending",
    retry_count: 0,
    test_results: [],
    static_analysis: null,
    ai_review: null,
  };
}

export function usePipeline(projectId: string | null): UsePipelineReturn {
  const demo = isDemoProject(projectId);
  const isLocal = !!projectId && projectId.startsWith("local");
  const offline = demo || isLocal;
  // Demo + locally-analysed projects don't open a real socket.
  const { status: wsStatus, subscribe } = useWebSocket(
    offline ? null : projectId,
  );
  const [state, setState] = useState<PipelineState>(() =>
    demo && projectId
      ? createDemoState(projectId)
      : { ...INITIAL_STATE, projectId },
  );
  const [finalizedFiles, setFinalizedFiles] = useState<Record<string, true>>({});
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const lessonsRef = useRef<Lesson[]>([]);

  useEffect(() => {
    lessonsRef.current = lessons;
  }, [lessons]);

  // Reset / load when the project changes. sessionStorage is client-only, so
  // local projects are loaded here (in an effect) rather than in the initializer.
  useEffect(() => {
    if (demo && projectId) {
      setState(createDemoState(projectId));
      setFinalizedFiles({});
      setLessons([]);
      return;
    }
    if (isLocal && projectId) {
      setFinalizedFiles(loadFileStatus(projectId) ?? {});
      setLessons(loadLessons(projectId) ?? []);
      const analysis = loadAnalysis(projectId);
      if (!analysis) {
        setState({ ...INITIAL_STATE, projectId });
        return;
      }
      const base = stateFromAnalysis(projectId, analysis);
      const progress = loadProgress(projectId);
      if (progress) {
        const chunks = base.chunks.map((c) => {
          const saved = progress[c.id];
          if (!saved) return c;
          // Entries saved before static_analysis/ai_review/test_results were
          // added to ChunkProgressEntry won't have those keys — fall back to
          // the freshly-computed chunk's defaults instead of overwriting with
          // undefined (which crashed ChunkReview's `test_results.filter(...)`).
          return {
            ...c,
            status: saved.status as typeof c.status,
            migrated_code: saved.migrated_code,
            static_analysis: saved.static_analysis ?? c.static_analysis,
            ai_review: saved.ai_review ?? c.ai_review,
            test_results: saved.test_results ?? c.test_results,
          };
        });
        const allApproved = chunks.every((c) => c.status === "Approved");
        setState({
          ...base,
          chunks,
          currentChunk: chunks.find((c) => c.status === "Review") ?? chunks.find((c) => c.status === "Pending") ?? chunks[0] ?? null,
          migrationComplete: allApproved,
          currentLayer: allApproved ? 4 : base.currentLayer,
        });
      } else {
        setState(base);
      }
      return;
    }
    setFinalizedFiles({});
    setLessons([]);
    setState({ ...INITIAL_STATE, projectId });
  }, [projectId, demo, isLocal]);

  // Backend projects keep lessons in the shared project record so the
  // feedback loop follows the authenticated user across devices.
  useEffect(() => {
    if (offline || !projectId) return;
    let cancelled = false;
    getProjectLessons(projectId)
      .then((loadedLessons) => {
        if (!cancelled) setLessons(loadedLessons);
      })
      .catch(() => {
        if (!cancelled) setLessons([]);
      });
    return () => {
      cancelled = true;
    };
  }, [offline, projectId]);

  // Backend-tracked (non-offline) projects don't have file content client-side
  // yet — fetch it best-effort so the file context panel/manifest can use it.
  useEffect(() => {
    if (offline || !projectId) return;
    let cancelled = false;
    getProjectFiles(projectId)
      .then((files: ProjectFile[]) => {
        if (cancelled || files.length === 0) return;
        setState((prev) => ({ ...prev, files }));
      })
      .catch(() => {
        // Files not ready yet (pipeline still running) — leave as [].
      });
    return () => {
      cancelled = true;
    };
  }, [offline, projectId]);

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
      subscribe("layer0_complete", () => {
        // Lower-level backend summary; archaeology_complete is the UI signal.
      }),
    );

    unsubs.push(
      subscribe("analysis_complete", () => {
        setLayer(0);
      }),
    );

    unsubs.push(
      subscribe("pipeline_failed", (e) => {
        setState((prev) => ({ ...prev, error: e.error }));
      }),
    );

    unsubs.push(
      subscribe("business_rule_found", (e) => {
        const rule = normalizeBusinessRule(e.rule);
        setState((prev) => ({
          ...prev,
          businessRules: [...prev.businessRules, rule],
          chunks:
            rule.chunk_id && !prev.chunks.some((c) => c.id === rule.chunk_id)
              ? [
                  ...prev.chunks,
                  {
                    id: rule.chunk_id,
                    name: rule.title,
                    source_file: rule.source_file,
                    start_line: rule.source_lines[0] ?? 0,
                    end_line: rule.source_lines[1] ?? 0,
                    source_code: "",
                    migrated_code: "",
                    diff: "",
                    risk_level: "Medium" as RiskLevel,
                    status: "Pending",
                    retry_count: 0,
                    test_results: [],
                    static_analysis: null,
                    ai_review: null,
                  },
                ]
              : prev.chunks,
        }));
      }),
    );

    unsubs.push(
      subscribe("dependency_graph_ready", (e) => {
        const graph = normalizeGraph(e.graph);
        const rawNodes =
          ((e.graph as unknown as { nodes?: Record<string, unknown>[] }).nodes ??
            []);
        const graphChunks = rawNodes.map(chunkFromGraphNode);
        setState((prev) => ({
          ...prev,
          dependencyGraph: graph,
          chunks: prev.chunks.length > 0 ? prev.chunks : graphChunks,
          currentChunk: prev.currentChunk ?? graphChunks[0] ?? null,
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
        // New pipeline emits target_profile=; class-based pipeline emits profile=
        const payload = e as unknown as Record<string, unknown>;
        const tp = (payload.target_profile ?? payload.profile ?? null) as TargetProfile | null;
        setState((prev) => ({
          ...prev,
          currentLayer: 0.5,
          targetProfile: tp,
        }));
      }),
    );

    unsubs.push(
      subscribe("chunk_started", (e) => {
        setState((prev) => {
          const existing = prev.chunks.find((c) => c.id === e.chunk_id);
          const newChunk: MigrationChunk = {
            ...(existing ?? {}),
            id: e.chunk_id,
            name: e.name,
            source_file: existing?.source_file ?? "",
            start_line: existing?.start_line ?? 0,
            end_line: existing?.end_line ?? 0,
            source_code: existing?.source_code ?? "",
            migrated_code: existing?.migrated_code ?? "",
            diff: existing?.diff ?? "",
            risk_level: existing?.risk_level ?? ("Medium" as RiskLevel),
            status: "Running",
            retry_count: existing?.retry_count ?? 0,
            test_results: existing?.test_results ?? [],
            static_analysis: existing?.static_analysis ?? null,
            ai_review: existing?.ai_review ?? null,
          };
          return {
            ...prev,
            currentLayer: 1,
            currentChunk: newChunk,
            chunks: [...prev.chunks.filter((c) => c.id !== e.chunk_id), newChunk],
          };
        });
      }),
    );

    unsubs.push(
      subscribe("chunk_selected", (e) => {
        setState((prev) => {
          const selected = prev.chunks.find((c) => c.id === e.chunk_id);
          return {
            ...prev,
            currentLayer: 1,
            currentChunk: selected
              ? { ...selected, status: "Running" }
              : prev.currentChunk,
            chunks: prev.chunks.map((c) =>
              c.id === e.chunk_id ? { ...c, status: "Running" } : c,
            ),
          };
        });
      }),
    );

    unsubs.push(
      subscribe("migration_generated", (e) => {
        setState((prev) => {
          const existing =
            prev.chunks.find((c) => c.id === e.chunk_id) ?? prev.currentChunk;
          const updated: MigrationChunk = {
            ...(existing ?? {
              id: e.chunk_id,
              name: e.chunk_id,
              source_file: "",
              start_line: 0,
              end_line: 0,
              source_code: "",
              diff: "",
              risk_level: "Medium" as RiskLevel,
              retry_count: 0,
              test_results: [],
              static_analysis: null,
              ai_review: null,
            }),
            id: e.chunk_id,
            migrated_code: e.migrated_code,
            status: "Review",
          };
          return {
            ...prev,
            currentLayer: 1,
            currentChunk: updated,
            chunks: prev.chunks.some((c) => c.id === updated.id)
              ? prev.chunks.map((c) => (c.id === updated.id ? updated : c))
              : [...prev.chunks, updated],
          };
        });
      }),
    );

    unsubs.push(
      subscribe("static_analysis_complete", (e) => {
        setState((prev) => {
          const target =
            (e.chunk_id
              ? prev.chunks.find((c) => c.id === e.chunk_id)
              : prev.currentChunk) ?? prev.currentChunk;
          if (!target) return prev;
          const updated: MigrationChunk = {
            ...target,
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
      subscribe("chunk_rejected", (e) => {
        setState((prev) => ({
          ...prev,
          chunks: prev.chunks.map((c) =>
            c.id === e.chunk_id ? { ...c, status: "Review" } : c,
          ),
        }));
      }),
    );

    unsubs.push(
      subscribe("ready_for_next_chunk", () => {
        setState((prev) => {
          const next = prev.chunks.find((c) => c.status === "Pending");
          return {
            ...prev,
            currentLayer: next ? 0 : prev.currentLayer,
            currentChunk: next ?? prev.currentChunk,
          };
        });
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
  // Auto-save progress for local projects
  // Runs after every chunk state change so a refresh restores approvals.
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!isLocal || !projectId || state.chunks.length === 0) return;
    saveProgress(projectId, state.chunks);
    const approved = state.chunks.filter((c) => c.status === "Approved").length;
    updateProjectProgress(projectId, {
      chunksApproved: approved,
      status: state.migrationComplete
        ? "complete"
        : approved > 0
          ? "in_progress"
          : "ready",
    });
  }, [state.chunks, state.migrationComplete, isLocal, projectId]);

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

  const patchChunk = useCallback(
    (chunkId: string, patch: Partial<MigrationChunk>) => {
      setState((prev) => ({
        ...prev,
        currentChunk:
          prev.currentChunk?.id === chunkId
            ? { ...prev.currentChunk, ...patch }
            : prev.currentChunk,
        chunks: prev.chunks.map((c) =>
          c.id === chunkId ? { ...c, ...patch } : c,
        ),
      }));
    },
    [],
  );

  const markFileFinalized = useCallback(
    (filename: string) => {
      setFinalizedFiles((prev) => {
        const next = { ...prev, [filename]: true as const };
        if (isLocal && projectId) saveFileStatus(projectId, next);
        return next;
      });
    },
    [isLocal, projectId],
  );

  const unmarkFileFinalized = useCallback(
    (filename: string) => {
      setFinalizedFiles((prev) => {
        if (!prev[filename]) return prev;
        const next = { ...prev };
        delete next[filename];
        if (isLocal && projectId) saveFileStatus(projectId, next);
        return next;
      });
    },
    [isLocal, projectId],
  );

  const addLesson = useCallback(
    (lesson: Lesson) => {
      // Dedupe by (sourceFile, text) so repeated identical findings don't pile up.
      if (lessonsRef.current.some((l) => l.sourceFile === lesson.sourceFile && l.text === lesson.text)) {
        return;
      }

      const next = [...lessonsRef.current, lesson];
      lessonsRef.current = next;
      setLessons(next);

      if (isLocal && projectId) {
        saveLessons(projectId, next);
        return;
      }

      if (!offline && projectId) {
        addProjectLesson(projectId, lesson)
          .then((savedLesson) => {
            setLessons((prev) =>
              prev.map((existing) =>
                existing.id === lesson.id ? savedLesson : existing,
              ),
            );
          })
          .catch(() => {
            // Keep the optimistic lesson in memory; a refresh will show the
            // durable server state and future additions can still succeed.
          });
      }
    },
    [isLocal, offline, projectId],
  );

  return {
    state,
    wsStatus: offline ? "connected" : wsStatus,
    markChunkApproved,
    markChunkRejected,
    updateRule,
    selectLayer: setLayer,
    advanceDemoChunk,
    patchChunk,
    finalizedFiles,
    markFileFinalized,
    unmarkFileFinalized,
    lessons,
    addLesson,
  };
}
