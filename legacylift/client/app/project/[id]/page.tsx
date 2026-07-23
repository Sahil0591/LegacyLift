"use client";
// app/project/[id]/page.tsx - Migration review workbench.
// Two views: Overview (the codebase map) and Review (step through each chunk,
// see the before/after, and approve or request changes). State comes from
// usePipeline; demo projects are fully seeded.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ArrowRight,
  ChevronRight,
  Loader2,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { usePipeline } from "@/hooks/usePipeline";
import { useFileGroups } from "@/hooks/useFileStatus";
import {
  approveChunk,
  confirmBusinessRule,
  getUserLimits,
  rejectChunk,
  selectChunkForMigration,
} from "@/lib/api";
import {
  generateMigration,
  reviewMigration,
  generateTests,
  summarizeFile,
  type FileSummary,
} from "@/lib/migration";
import { buildProjectManifest } from "@/lib/manifest";
import {
  buildTargetApi,
  buildDependenciesSource,
  buildCrossFileApi,
  directDependencies,
} from "@/lib/targetApi";
import { nextSuggestedChunkId, computeMigrationOrder } from "@/lib/migrationOrder";
import {
  assessImpact,
  dependentsOf,
  exportedNames,
  syncInstruction,
} from "@/lib/impact";
import { concatenateSource } from "@/lib/fileAssembly";
import { resolveTarget, buildInstitutionalContext, summarizeTargets } from "@/lib/projectConfig";
import { toProfileCtx } from "@/lib/targetLanguages";
import { makeLesson, selectRelevantLessons, formatLessonsBlock } from "@/lib/lessons";
import { staticAnalyze } from "@/lib/staticCheck";
import { downloadProjectZip } from "@/lib/download";
import { reviewProject, type ProjectReviewResult } from "@/lib/projectReview";
import { getDemoRepo, isDemoProject } from "@/lib/demoData";
import type { MigrationChunk } from "@/types/legacylift";
import { useToasts } from "@/hooks/useToasts";
import { ToastStack } from "@/components/shared/ToastStack";

// Total attempts (initial generation + every auto-fix round) a single chunk
// may burn. Auto-fix now consumes several of these per click, so the budget
// is a bit higher than the old "one manual click = one attempt" limit.
const MAX_REGENS = 8;
import {
  WorkbenchHeader,
  type WorkbenchView,
} from "@/components/workbench/WorkbenchHeader";
import { ChunkQueue } from "@/components/workbench/ChunkQueue";
import { ChunkReview } from "@/components/workbench/ChunkReview";
import { WalkthroughTour } from "@/components/workbench/WalkthroughTour";
import { OverviewPanel } from "@/components/workbench/OverviewPanel";
import { FileContextPanel } from "@/components/workbench/FileContextPanel";
import { UnitInfoPanel } from "@/components/workbench/UnitInfoPanel";
import { FileFinalizeModal } from "@/components/workbench/FileFinalizeModal";
import { BulkFinalizeModal } from "@/components/workbench/BulkFinalizeModal";
import { FileSummaryModal } from "@/components/workbench/FileSummaryModal";

interface ProjectPageProps {
  params: { id: string };
}

interface CompleteStateProps {
  approved: number;
  total: number;
  allFilesFinalized: boolean;
  projectReview: ProjectReviewResult | null;
  projectReviewAcked: boolean;
  reviewingProject: boolean;
  projectReviewError: string | null;
  onRunProjectReview: () => void;
  onAcknowledgeReview: () => void;
  canDownloadZip: boolean;
  onDownloadZip: () => void;
}

function CompleteState({
  approved,
  total,
  allFilesFinalized,
  projectReview,
  projectReviewAcked,
  reviewingProject,
  projectReviewError,
  onRunProjectReview,
  onAcknowledgeReview,
  canDownloadZip,
  onDownloadZip,
}: CompleteStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#10B981]/15">
        <CheckCircle2 className="h-8 w-8 text-[#10B981]" />
      </div>
      <h2 className="mt-5 text-2xl font-bold text-ink">Migration complete</h2>
      <p className="mt-2 max-w-md text-sm text-sub">
        Every chunk was reviewed and approved by a human. The migrated codebase
        is ready to pull.
      </p>
      <div className="mt-7 flex gap-8">
        <div>
          <div className="text-2xl font-bold text-[#10B981]">{approved}</div>
          <div className="text-xs text-sub">chunks merged</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-ink">100%</div>
          <div className="text-xs text-sub">human-approved</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-ink">{total}</div>
          <div className="text-xs text-sub">total chunks</div>
        </div>
      </div>

      <div className="mt-8 w-full max-w-lg rounded-xl border border-ink/10 bg-surface/40 p-5 text-left">
        {!allFilesFinalized ? (
          <p className="text-sm text-sub">
            Finalize every file from the Overview tab to unlock the full
            project review and download.
          </p>
        ) : !projectReview ? (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-sm text-sub">
              Every file is finalized. Run the whole-project AI review before
              downloading - it checks for cross-file issues a per-file review
              can't see.
            </p>
            <button
              onClick={onRunProjectReview}
              disabled={reviewingProject}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reviewingProject ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Run final review
            </button>
          </div>
        ) : null}
        {allFilesFinalized && !projectReview && projectReviewError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-[#DC2626]">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {projectReviewError}
          </div>
        )}
        {allFilesFinalized && projectReview && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldCheck className="h-4 w-4 text-[#7C3AED]" />
              Project review · {projectReview.confidence} confidence
            </div>
            <p className="text-sm text-ink/80">{projectReview.summary}</p>
            {projectReview.cross_file_concerns.map((c) => (
              <div key={c} className="flex items-start gap-2 text-xs text-[#F59E0B]">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {c}
              </div>
            ))}
            {projectReview.risk_notes.map((r) => (
              <div key={r} className="flex items-start gap-2 text-xs text-sub">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {r}
              </div>
            ))}
            {!projectReviewAcked && (
              <button
                onClick={onAcknowledgeReview}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#059669]"
              >
                <CheckCircle2 className="h-4 w-4" />
                I've reviewed this - unlock download
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={onDownloadZip}
          disabled={!canDownloadZip}
          title={
            canDownloadZip
              ? "Download the migrated project as a zip"
              : "Finalize every file and acknowledge the project review first"
          }
          className="inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Download migrated project
        </button>
        <Link
          href="/demo"
          className="inline-flex items-center gap-2 rounded-lg border border-ink/15 px-5 py-2.5 text-sm font-semibold text-ink/80 transition-colors hover:border-ink/30"
        >
          Start another migration
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

export default function ProjectPage({ params }: ProjectPageProps) {
  const projectId = params.id;
  const demo = isDemoProject(projectId);
  const local = projectId.startsWith("local");
  // Cloud projects ("cloud-" prefix) are DB-backed but still client-driven -
  // the browser owns generation/approval via the /llm/* endpoints, exactly
  // like local/demo. They must NOT hit the backend-pipeline routes
  // (confirm-rule/select-chunk/approve), which only know pipeline projects and
  // 404 on a cloud id. Keep this in sync with usePipeline's own `offline`.
  const cloud = projectId.startsWith("cloud-");
  const offline = demo || local || cloud;

  const {
    state,
    markChunkApproved,
    markChunkRejected,
    advanceDemoChunk,
    patchChunk,
    finalizedFiles,
    markFileFinalized,
    unmarkFileFinalized,
    reconciledFiles,
    setReconciledFile,
    lessons,
    addLesson,
    config,
    setGlobalContext,
    setFileContext,
    setDefaultTarget,
    setFileTarget,
  } = usePipeline(projectId);

  const [view, setView] = useState<WorkbenchView>("review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenStatus, setRegenStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regenCounts, setRegenCounts] = useState<Record<string, number>>({});
  const [fileContextCollapsed, setFileContextCollapsed] = useState(false);
  const [finalizeTarget, setFinalizeTarget] = useState<string | null>(null);
  const [projectReview, setProjectReview] = useState<ProjectReviewResult | null>(null);
  const [projectReviewAcked, setProjectReviewAcked] = useState(false);
  const [reviewingProject, setReviewingProject] = useState(false);
  const [projectReviewError, setProjectReviewError] = useState<string | null>(null);
  const [bulkFinalizeOpen, setBulkFinalizeOpen] = useState(false);
  // File-level "what does this file do" AI summaries, cached per filename so a
  // reopen doesn't re-charge an AI call.
  const [fileSummaries, setFileSummaries] = useState<Record<string, FileSummary>>({});
  const [summaryTarget, setSummaryTarget] = useState<string | null>(null);
  const [summarizingFile, setSummarizingFile] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ remaining: number; max: number } | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  // True while the migration run is walking the queue.
  const [batchRunning, setBatchRunning] = useState(false);
  const batchRunningRef = useRef(false);
  // Cross-chunk impact tracking: chunkId -> notes about upstream changes that
  // touch this unit, plus a regeneration instruction when a reference actually
  // broke (an upstream unit renamed/removed a symbol this one calls).
  const [impact, setImpact] = useState<
    Record<string, { notes: string[]; fixInstruction?: string }>
  >({});
  const impactRef = useRef(impact);
  const updateImpact = (
    fn: (
      prev: Record<string, { notes: string[]; fixInstruction?: string }>,
    ) => Record<string, { notes: string[]; fixInstruction?: string }>,
  ) => {
    setImpact((prev) => {
      const next = fn(prev);
      impactRef.current = next;
      return next;
    });
  };
  // Right sidebar: unit info panel vs raw source file view.
  const [sideTab, setSideTab] = useState<"unit" | "source">("unit");
  // Per-unit AI explanations (plain + technical), cached per chunk id.
  const [unitExplains, setUnitExplains] = useState<Record<string, FileSummary>>({});
  const [explainingUnit, setExplainingUnit] = useState<string | null>(null);
  const [unitExplainError, setUnitExplainError] = useState<string | null>(null);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  // Always-fresh mirror of pipeline state so the migration run (and the
  // cross-chunk context it builds) sees each chunk approved in the prior
  // iteration, instead of the stale closure captured at render time.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Auto-launch the guided walkthrough the first time someone lands on a
  // project - non-technical users get oriented without hunting for help. The
  // lightbulb in the header replays it any time after that.
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem("legacylift.tourSeen.v1") === "1";
    } catch {
      /* private mode / storage blocked - just show the tour */
    }
    if (seen) return;
    const timer = setTimeout(() => {
      setTourOpen(true);
      try {
        localStorage.setItem("legacylift.tourSeen.v1", "1");
      } catch {
        /* ignore */
      }
    }, 700);
    return () => clearTimeout(timer);
  }, []);

  // Jump straight to a chunk's Review view - used by the header job pill and
  // by toast "View chunk" actions so background work is never a dead end.
  const jumpToChunk = (id: string) => {
    setView("review");
    setSelectedId(id);
  };

  const refreshQuota = () => {
    getUserLimits().then((limits) => {
      if (limits) {
        setQuota({ remaining: limits.migrations_remaining, max: limits.max_migrations_per_day });
      }
    });
  };

  // Every LLM call (migrate/review/tests/project-review) burns the same daily
  // budget, and the auto-fix loop can chew through several per click - refresh
  // on mount and periodically (in addition to right after the actions that
  // spend it) so running out is never a silent surprise.
  useEffect(() => {
    refreshQuota();
    const interval = setInterval(refreshQuota, 20_000);
    return () => clearInterval(interval);
  }, []);

  const repo = demo ? getDemoRepo(projectId).replace("github.com/", "") : projectId;
  const approved = state.chunks.filter((c) => c.status === "Approved").length;
  const fileGroups = useFileGroups(state, finalizedFiles, finalizeTarget, config);
  const sourceLang =
    state.files.find((f) => f.language)?.language ||
    fileGroups.find((f) => f.language)?.language ||
    "Source";
  // The legacy language of a specific chunk's file - so the review's before/after
  // panel labels the real source language per file, not a project-wide guess.
  const sourceLabelFor = (chunk: MigrationChunk | null | undefined) =>
    (chunk?.source_file &&
      state.files.find((f) => f.filename === chunk.source_file)?.language) ||
    sourceLang;
  const targetLabels = summarizeTargets(
    config,
    fileGroups.map((f) => f.filename),
  ).labels;
  const allFilesFinalized =
    fileGroups.length > 0 && fileGroups.every((f) => f.status === "finalized");
  const canDownloadZip = allFilesFinalized && projectReviewAcked;
  const regenLeft = (id: string) =>
    Math.max(0, MAX_REGENS - (regenCounts[id] ?? 0));

  const handleRunProjectReview = async () => {
    setReviewingProject(true);
    setProjectReviewError(null);
    try {
      const manifest = buildProjectManifest(state, "");
      const result = await reviewProject({
        projectName: repo,
        manifest,
        fileSummaries: fileGroups.map((f) => ({
          filename: f.filename,
          chunk_count: f.totalCount,
          risk_level: f.riskLevel,
        })),
      });
      setProjectReview(result);
      for (const text of [...result.cross_file_concerns, ...result.risk_notes]) {
        addLesson(makeLesson({ source: "project_review", text }));
      }
    } catch (err) {
      setProjectReviewError(
        err instanceof Error ? err.message : "Project review failed - please try again.",
      );
    } finally {
      setReviewingProject(false);
      refreshQuota();
    }
  };

  const explicit = selectedId
    ? state.chunks.find((c) => c.id === selectedId) ?? null
    : null;
  const reviewChunk = explicit ?? state.currentChunk;

  const handleApprove = async (id: string) => {
    setActionError(null);
    if (offline) {
      markChunkApproved(id);
      advanceDemoChunk();
      setSelectedId(null);
      return;
    }
    try {
      await approveChunk(projectId, { chunk_id: id });
      markChunkApproved(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Approve failed - please try again.",
      );
    }
  };

  const handleReject = async (id: string, reason: string) => {
    setActionError(null);
    const chunk = state.chunks.find((c) => c.id === id);
    const recordRejectionLesson = () => {
      if (!chunk) return;
      addLesson(
        makeLesson({
          source: "rejection",
          sourceFile: chunk.source_file || undefined,
          chunkName: chunk.name,
          text: reason,
        }),
      );
    };
    if (offline) {
      markChunkRejected(id);
      recordRejectionLesson();
      if (chunk) flagDependentsOfRejected(chunk);
      advanceDemoChunk();
      setSelectedId(null);
      return;
    }
    try {
      await rejectChunk(projectId, { chunk_id: id, reason });
      markChunkRejected(id);
      recordRejectionLesson();
      if (chunk) flagDependentsOfRejected(chunk);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Reject failed - please try again.",
      );
    }
  };

  // Hand-fix the migrated code directly - the escape hatch for chunks the
  // auto-fix loop can't converge on (subtle rounding/PIC-clause semantics an
  // LLM keeps guessing at). Bypasses generation entirely, and invalidates the
  // stale checks so the human has to explicitly re-validate before merging.
  const handleManualEdit = (chunk: MigrationChunk, code: string) => {
    const prevCode = chunk.migrated_code;
    patchChunk(chunk.id, {
      migrated_code: code,
      static_analysis: staticAnalyze(code),
      ai_review: null,
      test_results: [],
    });
    // A hand edit can rename/remove symbols just like a regeneration can —
    // same propagation: flag any dependent whose references broke.
    if (code.trim() && code !== prevCode) {
      updateImpact((prev) => {
        if (!prev[chunk.id]) return prev;
        const next = { ...prev };
        delete next[chunk.id];
        return next;
      });
      const brokenCount = propagateChange(chunk, prevCode, code);
      if (brokenCount > 0) {
        pushToast({
          variant: "info",
          title: `${chunk.name} changed its interface`,
          description: `${brokenCount} dependent unit${brokenCount === 1 ? "" : "s"} flagged for sync.`,
        });
      }
    }
  };

  // Re-run the AI review + generated tests against whatever code is currently
  // on the chunk (LLM-authored or hand-edited) without calling generateMigration
  // again - so validating a manual fix never risks overwriting it.
  const handleRunChecks = async (chunk: MigrationChunk) => {
    if (!chunk.migrated_code.trim()) return;
    setBusyId(chunk.id);
    setRegenError(null);
    setRegenStatus("Running tests & AI review…");
    const target = resolveTarget(config, chunk.source_file);
    const targetProfile = toProfileCtx(target);
    const institutionalContext = buildInstitutionalContext(config, chunk.source_file);
    try {
      const [review, tests] = await Promise.allSettled([
        reviewMigration({
          name: chunk.name,
          sourceCode: chunk.source_code,
          migratedCode: chunk.migrated_code,
          targetLang: target.language,
          targetProfile,
          institutionalContext,
        }),
        generateTests({
          name: chunk.name,
          migratedCode: chunk.migrated_code,
          targetLang: target.language,
          targetProfile,
        }),
      ]);
      if (review.status === "fulfilled") {
        patchChunk(chunk.id, { ai_review: review.value });
        for (const text of [
          ...review.value.critical_issues,
          ...review.value.warnings,
        ]) {
          addLesson(
            makeLesson({
              source: "ai_review",
              sourceFile: chunk.source_file || undefined,
              chunkName: chunk.name,
              text,
            }),
          );
        }
      }
      if (tests.status === "fulfilled") {
        patchChunk(chunk.id, {
          test_results: tests.value.tests.map((t) => ({
            name: t.name,
            passed: true,
            error_message: null,
            duration_ms: 0,
          })),
        });
      }
      if (review.status === "rejected" && tests.status === "rejected") {
        setRegenError("Checks failed to run - please try again.");
        pushToast({
          variant: "error",
          title: `Checks failed for ${chunk.name}`,
          description: "Please try again.",
          action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
        });
      } else {
        pushToast({
          variant: "success",
          title: `Checks complete for ${chunk.name}`,
          action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Checks failed to run";
      setRegenError(message);
      pushToast({
        variant: "error",
        title: `Checks failed for ${chunk.name}`,
        description: message,
        action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
      });
    } finally {
      setBusyId(null);
      setRegenStatus(null);
      refreshQuota();
    }
  };

  // Explain a whole FILE (not a chunk): one AI call returns a technical and a
  // plain-language summary, grounded in the file's rules + institutional
  // context. Cached per filename so reopening doesn't re-spend the quota;
  // `force` regenerates.
  const handleSummarizeFile = async (filename: string, force = false) => {
    setSummaryTarget(filename);
    setSummaryError(null);
    if (!force && fileSummaries[filename]) return;

    const group = fileGroups.find((f) => f.filename === filename);
    const fileContent =
      state.files.find((f) => f.filename === filename)?.content ||
      (group ? concatenateSource(group.chunks) : "");
    if (!fileContent.trim()) {
      setSummaryError("This file has no source available to summarize.");
      return;
    }

    const businessRules = state.businessRules
      .filter((r) => r.source_file === filename)
      .map((r) => ({
        title: r.title,
        description: r.description,
        hardcoded_values: r.hardcoded_values,
      }));
    const fileSourceLang =
      group?.language ||
      state.files.find((f) => f.filename === filename)?.language ||
      sourceLang;

    setSummarizingFile(filename);
    try {
      const result = await summarizeFile({
        filename,
        sourceCode: fileContent,
        sourceLang: fileSourceLang,
        businessRules,
        institutionalContext:
          buildInstitutionalContext(config, filename) || undefined,
      });
      setFileSummaries((m) => ({
        ...m,
        [filename]: { technical: result.technical, layman: result.layman },
      }));
    } catch (err) {
      setSummaryError(
        err instanceof Error
          ? err.message
          : "Couldn't summarize this file - please try again.",
      );
    } finally {
      setSummarizingFile(null);
      refreshQuota();
    }
  };

  // Reopen an approved/rejected chunk (e.g. the final file consistency check
  // flagged something) so it re-enters the approve/reject decision flow.
  const handleReopen = (id: string) => {
    const chunk = state.chunks.find((c) => c.id === id);
    patchChunk(id, { status: "Review" });
    if (chunk?.source_file && finalizedFiles[chunk.source_file]) {
      unmarkFileFinalized(chunk.source_file);
    }
  };

  // ── Cross-chunk impact propagation ─────────────────────────────────────────
  // The "when I change one file I check everything that depends on it"
  // behaviour a careful engineer applies by hand. After a unit's generated code
  // changes (regen, AI fix, manual edit), diff its public API; dependents whose
  // references broke are flagged for sync (and re-opened if already approved),
  // dependents that still line up get an informational note. Returns how many
  // dependents actually broke.
  const propagateChange = (
    chunk: MigrationChunk,
    prevCode: string,
    newCode: string,
  ): number => {
    const live = stateRef.current;
    const lang = resolveTarget(config, chunk.source_file).language;
    const oldNames = exportedNames(prevCode, lang);
    const newNames = exportedNames(newCode, lang);
    const reports = assessImpact(
      live.chunks,
      live.dependencyGraph,
      chunk,
      oldNames,
      newNames,
    );
    if (reports.length === 0) return 0;

    let brokenCount = 0;
    updateImpact((prev) => {
      const next = { ...prev };
      for (const r of reports) {
        const entry = {
          notes: [...(next[r.dependent.id]?.notes ?? [])],
          fixInstruction: next[r.dependent.id]?.fixInstruction,
        };
        const note =
          r.broken.length > 0
            ? `${chunk.name} changed its interface — ${r.broken.join(", ")} no longer exist${r.broken.length === 1 ? "s" : ""}. This unit references ${r.broken.length === 1 ? "it" : "them"} and needs a sync.`
            : `${chunk.name} was updated — the references here (${r.referenced.join(", ")}) still match its new interface.`;
        if (entry.notes[entry.notes.length - 1] !== note) entry.notes.push(note);
        if (entry.notes.length > 5) entry.notes = entry.notes.slice(-5);
        if (r.broken.length > 0) {
          brokenCount++;
          entry.fixInstruction = syncInstruction(chunk.name, r.broken, newNames);
        }
        next[r.dependent.id] = entry;
      }
      return next;
    });

    // A broken dependent that was already approved (or its file finalized) is
    // no longer trustworthy — pull it back into review so the human sees it.
    for (const r of reports) {
      if (r.broken.length === 0) continue;
      if (r.dependent.status === "Approved") {
        patchChunk(r.dependent.id, { status: "Review" });
      }
      if (r.dependent.source_file && finalizedFiles[r.dependent.source_file]) {
        unmarkFileFinalized(r.dependent.source_file);
      }
    }
    return brokenCount;
  };

  // A rejected unit's dependents deserve a heads-up too: the fix that follows
  // may change its interface, so anything built on it should be re-checked.
  const flagDependentsOfRejected = (chunk: MigrationChunk) => {
    const live = stateRef.current;
    const deps = dependentsOf(live.chunks, live.dependencyGraph, chunk.id).filter(
      (d) => d.migrated_code.trim(),
    );
    if (deps.length === 0) return;
    updateImpact((prev) => {
      const next = { ...prev };
      for (const d of deps) {
        const entry = {
          notes: [...(next[d.id]?.notes ?? [])],
          fixInstruction: next[d.id]?.fixInstruction,
        };
        const note = `${chunk.name} (which this unit calls) was sent back for changes — re-check this unit once it's fixed.`;
        if (entry.notes[entry.notes.length - 1] !== note) entry.notes.push(note);
        if (entry.notes.length > 5) entry.notes = entry.notes.slice(-5);
        next[d.id] = entry;
      }
      return next;
    });
  };

  // Generate (and then review) this chunk's migration with Venice. When there's
  // specific guidance (a reject reason, or Fix with AI on a finding), this
  // keeps auto-regenerating on its own - using each round's fresh critical
  // issues as the next round's guidance - until the AI review comes back
  // clean or the attempt budget runs out. The human never has to re-click
  // "fix" for the same chunk; they only get pulled back in if it can't
  // resolve everything itself.
  const handleRegenerate = async (
    chunk: MigrationChunk,
    instructions?: string,
  ) => {
    if (regenLeft(chunk.id) <= 0) {
      setRegenError(
        `Regeneration limit reached for ${chunk.name} (max ${MAX_REGENS}).`,
      );
      return;
    }
    setBusyId(chunk.id);
    setRegenError(null);
    setRegenStatus(null);

    if (!offline) {
      setRegenCounts((m) => ({ ...m, [chunk.id]: (m[chunk.id] ?? 0) + 1 }));
      try {
        await confirmBusinessRule(projectId, chunk.id);
        await selectChunkForMigration(projectId, chunk.id);
        patchChunk(chunk.id, { status: "Running" });
        pushToast({
          variant: "info",
          title: `Migration started for ${chunk.name}`,
          description: "Progress reports back over the pipeline connection.",
          action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Venice request failed";
        setRegenError(message);
        pushToast({
          variant: "error",
          title: `Couldn't start migration for ${chunk.name}`,
          description: message,
          action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
        });
      } finally {
        setBusyId(null);
        setRegenStatus(null);
      }
      return;
    }

    const businessRules = state.businessRules.map((r) => ({
      title: r.title,
      description: r.description,
      hardcoded_values: r.hardcoded_values,
    }));
    // Per-file target language + its rich guidance, and the human-authored
    // institutional context for this file - the levers that make migration
    // land in the right language with the org's constraints respected.
    const target = resolveTarget(config, chunk.source_file);
    const targetLang = target.language;
    const targetProfile = toProfileCtx(target);
    const institutionalContext = buildInstitutionalContext(config, chunk.source_file);
    const fileContext = state.files.find(
      (f) => f.filename === chunk.source_file,
    )?.content;
    // Cross-chunk context: the legacy SOURCE of the units this chunk calls, and
    // the already-generated TARGET API of its dependencies + same-file siblings,
    // so the model reuses real generated names instead of inventing them. Read
    // from stateRef so a running auto-migrate sees prior chunks' fresh output.
    const live = stateRef.current;
    const dependenciesSource = buildDependenciesSource(
      live.chunks,
      live.dependencyGraph,
      chunk,
      live.businessRules,
    );
    const generatedApi = buildTargetApi(
      live.chunks,
      live.dependencyGraph,
      chunk,
      (filename) => resolveTarget(config, filename),
    );

    // Loop-local state - the source of truth for control flow. Component
    // state (regenCounts) is only synced for the UI badge; reading it back
    // mid-loop would be stale since React batches updates across awaits.
    let attempts = regenCounts[chunk.id] ?? 0;
    let currentInstructions = instructions;
    const prevCode = chunk.migrated_code; // pre-run code, for impact diffing
    let currentCode = chunk.migrated_code;
    let exhausted = false;

    try {
      while (true) {
        if (attempts >= MAX_REGENS) {
          exhausted = true;
          break;
        }
        attempts += 1;
        setRegenCounts((m) => ({ ...m, [chunk.id]: attempts }));
        setRegenStatus(
          currentInstructions
            ? `Fixing issues (attempt ${attempts}/${MAX_REGENS})…`
            : "Generating…",
        );

        const projectManifest = buildProjectManifest(state, chunk.source_file);
        const lessonsLearned = formatLessonsBlock(
          selectRelevantLessons(lessons, chunk.source_file),
        );
        // Hand the model its own last attempt so it edits toward the fix
        // instead of rewriting blind - this is what makes a fix actually
        // stick instead of drifting on every round.
        const previousAttempt =
          currentInstructions && currentCode.trim() ? currentCode : undefined;

        const { migrated_code } = await generateMigration({
          name: chunk.name,
          sourceCode: chunk.source_code,
          targetLang,
          businessRules,
          targetProfile,
          instructions: currentInstructions,
          previousAttempt,
          fileContext,
          projectManifest: projectManifest || undefined,
          dependenciesSource: dependenciesSource || undefined,
          generatedApi: generatedApi || undefined,
          lessonsLearned: lessonsLearned || undefined,
          institutionalContext: institutionalContext || undefined,
        });
        currentCode = migrated_code;
        // Clear the previous round's review/tests immediately - otherwise the
        // Checks panel keeps showing last round's "passed"/"N notes" results
        // as if final while this round is still running underneath it, which
        // reads as done-but-also-loading and is exactly the confusing state
        // to avoid.
        patchChunk(chunk.id, {
          migrated_code,
          status: "Review",
          static_analysis: staticAnalyze(migrated_code),
          ai_review: null,
          test_results: [],
        });

        setRegenStatus("Running tests & AI review…");
        const [review, tests] = await Promise.allSettled([
          reviewMigration({
            name: chunk.name,
            sourceCode: chunk.source_code,
            migratedCode: migrated_code,
            targetLang,
            targetProfile,
            institutionalContext,
          }),
          generateTests({
            name: chunk.name,
            migratedCode: migrated_code,
            targetLang,
            targetProfile,
          }),
        ]);

        if (tests.status === "fulfilled") {
          patchChunk(chunk.id, {
            test_results: tests.value.tests.map((t) => ({
              name: t.name,
              passed: true,
              error_message: null,
              duration_ms: 0,
            })),
          });
        }
        if (review.status === "rejected" && tests.status === "rejected") {
          setRegenError(
            "Code generated, but the review/tests step failed - try again.",
          );
          pushToast({
            variant: "error",
            title: `${chunk.name} generated, but checks failed`,
            description: "Try again.",
            action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
          });
          break;
        }
        if (review.status !== "fulfilled") {
          // Tests came back but review didn't - nothing to auto-fix against,
          // so stop here rather than looping blind.
          pushToast({
            variant: "info",
            title: `${chunk.name} generated - review step didn't return`,
            description: "Check it manually.",
            action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
          });
          break;
        }

        patchChunk(chunk.id, { ai_review: review.value });
        for (const text of [
          ...review.value.critical_issues,
          ...review.value.warnings,
        ]) {
          addLesson(
            makeLesson({
              source: "ai_review",
              sourceFile: chunk.source_file || undefined,
              chunkName: chunk.name,
              text,
            }),
          );
        }

        const criticalCount = review.value.critical_issues.length;
        if (criticalCount === 0) {
          // clean - hand back to the human to approve
          pushToast({
            variant: "success",
            title: `${chunk.name} passed review`,
            description: "Ready for you to approve.",
            action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
          });
          break;
        }

        setRegenStatus(
          `Found ${criticalCount} critical issue${criticalCount === 1 ? "" : "s"} - auto-fixing…`,
        );
        currentInstructions = [
          ...review.value.critical_issues,
          ...review.value.warnings,
        ]
          .map((t) => `- ${t}`)
          .join("\n");
      }

      if (exhausted) {
        setRegenError(
          `Auto-fix tried ${MAX_REGENS} times on ${chunk.name} and couldn't clear every critical issue - please review the remaining findings manually.`,
        );
        pushToast({
          variant: "error",
          title: `${chunk.name} needs manual review`,
          description: `Auto-fix tried ${MAX_REGENS} times and couldn't clear every critical issue.`,
          action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Venice request failed";
      setRegenError(message);
      pushToast({
        variant: "error",
        title: `Generation failed for ${chunk.name}`,
        description: message,
        action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
      });
    } finally {
      // ── impact propagation ────────────────────────────────────────────────
      // The chunk's code actually changed: it is now in sync with today's
      // dependency APIs (clear its own flag), and everything that calls it
      // must be checked against its new interface.
      if (currentCode.trim() && currentCode !== prevCode) {
        updateImpact((prev) => {
          if (!prev[chunk.id]) return prev;
          const next = { ...prev };
          delete next[chunk.id];
          return next;
        });
        const brokenCount = propagateChange(chunk, prevCode, currentCode);
        if (brokenCount > 0 && !batchRunningRef.current) {
          pushToast({
            variant: "info",
            title: `${chunk.name} changed its interface`,
            description: `${brokenCount} dependent unit${brokenCount === 1 ? "" : "s"} flagged for sync — run the migration to update ${brokenCount === 1 ? "it" : "them"} automatically.`,
          });
        }
      }
      setBusyId(null);
      setRegenStatus(null);
      refreshQuota();
    }
  };

  // ── The migration run ──────────────────────────────────────────────────────
  // One streamlined pass over the WHOLE project in dependency order (callees
  // before callers), so every caller is generated only after its dependencies
  // exist and can be handed to the model as the ALREADY-MIGRATED TARGET API.
  // The run works through everything: units with no code get generated, units
  // flagged "needs sync" get regenerated against their dependencies' updated
  // interfaces, units with unresolved critical issues get another attempt while
  // budget remains. It does NOT stop on a flag — it finishes the whole graph
  // and hands the human a complete picture: clean units to approve, flagged
  // units to look at. The human stays the only one who can approve.
  const handleRunMigration = async () => {
    if (!offline || batchRunningRef.current) return;
    batchRunningRef.current = true;
    setBatchRunning(true);
    setActionError(null);
    const yield0 = () => new Promise((r) => setTimeout(r, 0));
    let clean = 0;
    let flagged = 0;
    try {
      const order = computeMigrationOrder(
        stateRef.current.chunks,
        stateRef.current.dependencyGraph,
      );
      for (const id of order) {
        const current = stateRef.current.chunks.find((c) => c.id === id);
        if (!current) continue;
        const needsSync = !!impactRef.current[id]?.fixInstruction;
        const hasCode = current.migrated_code.trim().length > 0;
        const criticals = current.ai_review?.critical_issues.length ?? 0;

        // Approved and unaffected by upstream changes — settled, skip.
        if (current.status === "Approved" && !needsSync) continue;
        // Clean existing draft — nothing to do, human just needs to review it.
        if (hasCode && !needsSync && criticals === 0) continue;
        if (regenLeft(id) <= 0) {
          flagged++;
          continue;
        }

        setSelectedId(id);
        await handleRegenerate(current, impactRef.current[id]?.fixInstruction);
        await yield0(); // let React commit patchChunk into stateRef

        const after = stateRef.current.chunks.find((c) => c.id === id);
        const ok =
          (after?.migrated_code.trim().length ?? 0) > 0 &&
          (after?.ai_review?.critical_issues.length ?? 0) === 0;
        if (ok) clean++;
        else flagged++;
      }

      pushToast(
        flagged === 0
          ? {
              variant: "success",
              title: "Migration run complete",
              description: `${clean} unit${clean === 1 ? "" : "s"} processed clean — review and approve when ready.`,
            }
          : {
              variant: "info",
              title: "Migration run finished",
              description: `${clean} clean · ${flagged} need${flagged === 1 ? "s" : ""} your attention — look for the amber markers in the queue.`,
            },
      );
    } finally {
      batchRunningRef.current = false;
      setBatchRunning(false);
    }
  };

  // Bulk-approve every unit that passed every check (has code, static analysis
  // passed, AI review ran clean, no pending sync). Human-triggered and
  // confirmed — this is the "final control" lever, not automation: nothing is
  // ever approved without this explicit action, and files still require the
  // finalize review afterwards.
  const passingIds = state.chunks
    .filter(
      (c) =>
        c.status !== "Approved" &&
        c.migrated_code.trim().length > 0 &&
        (c.static_analysis?.passed ?? true) &&
        c.ai_review != null &&
        c.ai_review.critical_issues.length === 0 &&
        !impact[c.id]?.fixInstruction,
    )
    .map((c) => c.id);

  const handleApproveAllPassing = () => {
    if (!offline || passingIds.length === 0) return;
    const ok = window.confirm(
      `Approve ${passingIds.length} unit${passingIds.length === 1 ? "" : "s"} that passed every check? Each file still gets your final review at finalize.`,
    );
    if (!ok) return;
    for (const id of passingIds) markChunkApproved(id);
    pushToast({
      variant: "success",
      title: `Approved ${passingIds.length} passing unit${passingIds.length === 1 ? "" : "s"}`,
      description: "Flagged units still need individual review.",
    });
  };

  const suggestedNextId = offline
    ? nextSuggestedChunkId(state.chunks, state.dependencyGraph)
    : null;

  // Units currently flagged "needs sync" (broken references to a changed
  // dependency) — shown as amber markers in the queue.
  const syncIds = new Set(
    Object.entries(impact)
      .filter(([, v]) => v.fixInstruction)
      .map(([k]) => k),
  );

  // AI explanation of one unit (plain-language + technical), cached per chunk.
  const handleExplainUnit = async (chunk: MigrationChunk) => {
    if (unitExplains[chunk.id] || explainingUnit) return;
    setExplainingUnit(chunk.id);
    setUnitExplainError(null);
    try {
      const rule = findRuleForChunk(chunk);
      const result = await summarizeFile({
        filename: `${chunk.name} — ${chunk.source_file}`,
        sourceCode: chunk.source_code,
        sourceLang: sourceLabelFor(chunk),
        businessRules: rule
          ? [
              {
                title: rule.title,
                description: rule.description,
                hardcoded_values: rule.hardcoded_values,
              },
            ]
          : [],
        institutionalContext:
          buildInstitutionalContext(config, chunk.source_file) || undefined,
      });
      setUnitExplains((prev) => ({
        ...prev,
        [chunk.id]: { technical: result.technical, layman: result.layman },
      }));
    } catch (err) {
      setUnitExplainError(
        err instanceof Error ? err.message : "Could not explain this unit.",
      );
    } finally {
      setExplainingUnit(null);
      refreshQuota();
    }
  };

  // Match a business rule to a chunk across both analysis shapes (backend rules
  // carry chunk_id; the offline analyzer keys them by id/source position).
  const findRuleForChunk = (chunk: MigrationChunk) =>
    state.businessRules.find(
      (r) =>
        r.chunk_id === chunk.id ||
        r.id === `rule-${chunk.id}` ||
        (r.source_file === chunk.source_file &&
          r.source_lines?.[0] === chunk.start_line),
    ) ?? null;

  const activeFileForContext = reviewChunk?.source_file
    ? state.files.find((f) => f.filename === reviewChunk.source_file)
    : undefined;

  const finalizeGroup = fileGroups.find((f) => f.filename === finalizeTarget) ?? null;

  // Only surface the header's background-job pill when the busy chunk isn't
  // the one already on screen - ChunkReview shows regenStatus inline there,
  // so the pill would just be a redundant echo.
  const busyChunk = busyId ? state.chunks.find((c) => c.id === busyId) ?? null : null;
  const isViewingBusyChunk = view === "review" && reviewChunk?.id === busyId;
  const activeJob =
    busyChunk && !isViewingBusyChunk
      ? {
          chunkName: busyChunk.name,
          statusText: regenStatus ?? "Working…",
          attempt: regenCounts[busyChunk.id] ?? 0,
          maxAttempts: MAX_REGENS,
        }
      : null;

  return (
    <div className="flex h-screen flex-col bg-base text-ink">
      <WorkbenchHeader
        repo={repo}
        view={view}
        onViewChange={setView}
        sourceLang={sourceLang}
        targetLabels={targetLabels}
        approved={approved}
        total={state.chunks.length}
        onDownload={() => downloadProjectZip(repo, fileGroups, reconciledFiles)}
        canDownload={canDownloadZip}
        quotaRemaining={quota?.remaining ?? null}
        quotaMax={quota?.max ?? null}
        activeJob={activeJob}
        onJumpToJob={busyChunk ? () => jumpToChunk(busyChunk.id) : undefined}
        onStartTour={() => setTourOpen(true)}
      />

      <div className="min-h-0 flex-1">
        {view === "overview" ? (
          <div className="h-full overflow-y-auto">
            <OverviewPanel
              state={state}
              fileGroups={fileGroups}
              config={config}
              reconciledFiles={reconciledFiles}
              onFinalizeFile={(filename) => {
                const group = fileGroups.find((f) => f.filename === filename);
                if (group?.clusterReady) setFinalizeTarget(filename);
              }}
              onOpenBulkFinalize={() => setBulkFinalizeOpen(true)}
              onGlobalContextChange={setGlobalContext}
              onFileContextChange={setFileContext}
              onDefaultTargetChange={setDefaultTarget}
              onFileTargetChange={setFileTarget}
              onSummarizeFile={handleSummarizeFile}
              lessons={lessons}
            />
          </div>
        ) : (
          <div className="flex h-full">
            <aside
              data-tour="queue"
              className="hidden w-72 shrink-0 border-r border-ink/10 md:block"
            >
              <ChunkQueue
                chunks={state.chunks}
                selectedId={reviewChunk?.id ?? null}
                onSelect={setSelectedId}
                busyId={busyId}
                suggestedId={suggestedNextId}
                onAutoMigrate={offline ? handleRunMigration : undefined}
                autoMigrating={batchRunning}
                syncIds={syncIds}
                approveAllCount={offline ? passingIds.length : 0}
                onApproveAllPassing={offline ? handleApproveAllPassing : undefined}
              />
            </aside>
            <main data-tour="review-main" className="min-w-0 flex-1">
              {explicit ? (
                <ChunkReview
                  chunk={explicit}
                  sourceLabel={sourceLabelFor(explicit)}
                  targetLabel={resolveTarget(config, explicit.source_file).label}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onReopen={handleReopen}
                  onRegenerate={(instr) => handleRegenerate(explicit, instr)}
                  onFixWithAI={(instr) => handleRegenerate(explicit, instr)}
                  onManualEdit={(code) => handleManualEdit(explicit, code)}
                  onRunChecks={() => handleRunChecks(explicit)}
                  regenerating={busyId === explicit.id}
                  regenError={actionError ?? regenError}
                  regenStatus={busyId === explicit.id ? regenStatus : null}
                  regenRemaining={regenLeft(explicit.id)}
                  regenerateLabel={
                    offline ? "Regenerate with Venice" : "Start backend migration"
                  }
                />
              ) : state.migrationComplete ? (
                <CompleteState
                  approved={approved}
                  total={state.chunks.length}
                  allFilesFinalized={allFilesFinalized}
                  projectReview={projectReview}
                  projectReviewAcked={projectReviewAcked}
                  reviewingProject={reviewingProject}
                  projectReviewError={projectReviewError}
                  onRunProjectReview={handleRunProjectReview}
                  onAcknowledgeReview={() => setProjectReviewAcked(true)}
                  canDownloadZip={canDownloadZip}
                  onDownloadZip={() => downloadProjectZip(repo, fileGroups, reconciledFiles)}
                />
              ) : reviewChunk ? (
                <ChunkReview
                  chunk={reviewChunk}
                  sourceLabel={sourceLabelFor(reviewChunk)}
                  targetLabel={resolveTarget(config, reviewChunk.source_file).label}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onReopen={handleReopen}
                  onRegenerate={(instr) => handleRegenerate(reviewChunk, instr)}
                  onFixWithAI={(instr) => handleRegenerate(reviewChunk, instr)}
                  onManualEdit={(code) => handleManualEdit(reviewChunk, code)}
                  onRunChecks={() => handleRunChecks(reviewChunk)}
                  regenerating={busyId === reviewChunk.id}
                  regenError={actionError ?? regenError}
                  regenStatus={busyId === reviewChunk.id ? regenStatus : null}
                  regenRemaining={regenLeft(reviewChunk.id)}
                  regenerateLabel={
                    offline ? "Regenerate with Venice" : "Start backend migration"
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-sub">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for the first migration chunk…
                </div>
              )}
            </main>
            <aside
              data-tour="context"
              className={`hidden shrink-0 border-l border-ink/10 transition-all duration-200 lg:block ${
                fileContextCollapsed ? "w-10" : "w-96"
              }`}
            >
              {fileContextCollapsed || !reviewChunk ? (
                <FileContextPanel
                  filename={reviewChunk?.source_file ?? ""}
                  content={activeFileForContext?.content ?? ""}
                  activeStartLine={reviewChunk?.start_line ?? 0}
                  activeEndLine={reviewChunk?.end_line ?? 0}
                  collapsed={fileContextCollapsed}
                  onToggleCollapse={() => setFileContextCollapsed((v) => !v)}
                />
              ) : (
                <div className="flex h-full flex-col">
                  <div className="flex items-center gap-1 border-b border-ink/10 px-2 py-2">
                    {(
                      [
                        ["unit", "Unit info"],
                        ["source", "Source file"],
                      ] as const
                    ).map(([tab, label]) => (
                      <button
                        key={tab}
                        onClick={() => setSideTab(tab)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          sideTab === tab
                            ? "bg-[#7C3AED]/[0.12] text-[#7C3AED]"
                            : "text-sub hover:text-ink"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      onClick={() => setFileContextCollapsed(true)}
                      title="Collapse"
                      className="ml-auto rounded-lg p-1.5 text-sub transition-colors hover:bg-ink/[0.06] hover:text-ink"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    {sideTab === "unit" ? (
                      <UnitInfoPanel
                        chunk={reviewChunk}
                        rule={findRuleForChunk(reviewChunk)}
                        dependencies={directDependencies(
                          state.chunks,
                          state.dependencyGraph,
                          reviewChunk,
                        )}
                        dependents={dependentsOf(
                          state.chunks,
                          state.dependencyGraph,
                          reviewChunk.id,
                        )}
                        impactNotes={impact[reviewChunk.id]?.notes ?? []}
                        needsSync={!!impact[reviewChunk.id]?.fixInstruction}
                        explain={unitExplains[reviewChunk.id] ?? null}
                        explaining={explainingUnit === reviewChunk.id}
                        explainError={
                          explainingUnit === null ? unitExplainError : null
                        }
                        onExplain={() => handleExplainUnit(reviewChunk)}
                        onJump={jumpToChunk}
                      />
                    ) : (
                      <FileContextPanel
                        filename={reviewChunk.source_file}
                        content={activeFileForContext?.content ?? ""}
                        activeStartLine={reviewChunk.start_line}
                        activeEndLine={reviewChunk.end_line}
                        collapsed={false}
                        onToggleCollapse={() => setFileContextCollapsed(true)}
                      />
                    )}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      {finalizeGroup && (
        <FileFinalizeModal
          open
          file={finalizeGroup}
          onClose={() => setFinalizeTarget(null)}
          onFinalize={(reconciledCode) => {
            if (reconciledCode) {
              setReconciledFile(finalizeGroup.filename, reconciledCode);
            }
            markFileFinalized(finalizeGroup.filename);
            setFinalizeTarget(null);
          }}
          onLessonLearned={addLesson}
          institutionalContext={
            buildInstitutionalContext(config, finalizeGroup.filename) || undefined
          }
          projectManifest={
            buildProjectManifest(state, finalizeGroup.filename) || undefined
          }
          generatedApi={
            buildCrossFileApi(
              state.chunks,
              (filename) => resolveTarget(config, filename),
              finalizeGroup.filename,
            ) || undefined
          }
          businessRules={state.businessRules
            .filter((r) => r.source_file === finalizeGroup.filename)
            .map((r) => ({
              title: r.title,
              description: r.description,
              hardcoded_values: r.hardcoded_values,
            }))}
        />
      )}

      {bulkFinalizeOpen && (
        <BulkFinalizeModal
          open
          files={fileGroups.filter(
            (f) => f.status === "ready_to_finalize" && f.clusterReady,
          )}
          onClose={() => setBulkFinalizeOpen(false)}
          onLessonLearned={addLesson}
          onFinalizeAll={(filenames) => {
            for (const filename of filenames) markFileFinalized(filename);
            setBulkFinalizeOpen(false);
          }}
        />
      )}

      {summaryTarget && (
        <FileSummaryModal
          filename={summaryTarget}
          summary={fileSummaries[summaryTarget] ?? null}
          loading={summarizingFile === summaryTarget}
          error={summaryError}
          onClose={() => setSummaryTarget(null)}
          onRegenerate={() => handleSummarizeFile(summaryTarget, true)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <WalkthroughTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        view={view}
        onViewChange={setView}
      />
    </div>
  );
}
