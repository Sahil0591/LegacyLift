"use client";
// app/project/[id]/page.tsx — Migration review workbench.
// Two views: Overview (the codebase map) and Review (step through each chunk,
// see the before/after, and approve or request changes). State comes from
// usePipeline; demo projects are fully seeded.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ArrowRight,
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
} from "@/lib/migration";
import { buildProjectManifest } from "@/lib/manifest";
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
import { OverviewPanel } from "@/components/workbench/OverviewPanel";
import { FileContextPanel } from "@/components/workbench/FileContextPanel";
import { FileFinalizeModal } from "@/components/workbench/FileFinalizeModal";
import { BulkFinalizeModal } from "@/components/workbench/BulkFinalizeModal";

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
              downloading — it checks for cross-file issues a per-file review
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
                I've reviewed this — unlock download
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
  const offline = demo || local;

  const {
    state,
    markChunkApproved,
    markChunkRejected,
    advanceDemoChunk,
    patchChunk,
    finalizedFiles,
    markFileFinalized,
    unmarkFileFinalized,
    lessons,
    addLesson,
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
  const [quota, setQuota] = useState<{ remaining: number; max: number } | null>(null);
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  // Jump straight to a chunk's Review view — used by the header job pill and
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
  // budget, and the auto-fix loop can chew through several per click — refresh
  // on mount and periodically (in addition to right after the actions that
  // spend it) so running out is never a silent surprise.
  useEffect(() => {
    refreshQuota();
    const interval = setInterval(refreshQuota, 20_000);
    return () => clearInterval(interval);
  }, []);

  const repo = demo ? getDemoRepo(projectId).replace("github.com/", "") : projectId;
  const approved = state.chunks.filter((c) => c.status === "Approved").length;
  const fileGroups = useFileGroups(state, finalizedFiles, finalizeTarget);
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
        err instanceof Error ? err.message : "Project review failed — please try again.",
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
        err instanceof Error ? err.message : "Approve failed — please try again.",
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
      advanceDemoChunk();
      setSelectedId(null);
      return;
    }
    try {
      await rejectChunk(projectId, { chunk_id: id, reason });
      markChunkRejected(id);
      recordRejectionLesson();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Reject failed — please try again.",
      );
    }
  };

  // Hand-fix the migrated code directly — the escape hatch for chunks the
  // auto-fix loop can't converge on (subtle rounding/PIC-clause semantics an
  // LLM keeps guessing at). Bypasses generation entirely, and invalidates the
  // stale checks so the human has to explicitly re-validate before merging.
  const handleManualEdit = (chunk: MigrationChunk, code: string) => {
    patchChunk(chunk.id, {
      migrated_code: code,
      static_analysis: staticAnalyze(code),
      ai_review: null,
      test_results: [],
    });
  };

  // Re-run the AI review + generated tests against whatever code is currently
  // on the chunk (LLM-authored or hand-edited) without calling generateMigration
  // again — so validating a manual fix never risks overwriting it.
  const handleRunChecks = async (chunk: MigrationChunk) => {
    if (!chunk.migrated_code.trim()) return;
    setBusyId(chunk.id);
    setRegenError(null);
    setRegenStatus("Running tests & AI review…");
    try {
      const [review, tests] = await Promise.allSettled([
        reviewMigration({
          name: chunk.name,
          sourceCode: chunk.source_code,
          migratedCode: chunk.migrated_code,
        }),
        generateTests({ name: chunk.name, migratedCode: chunk.migrated_code }),
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
        setRegenError("Checks failed to run — please try again.");
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

  // Reopen an approved/rejected chunk (e.g. the final file consistency check
  // flagged something) so it re-enters the approve/reject decision flow.
  const handleReopen = (id: string) => {
    const chunk = state.chunks.find((c) => c.id === id);
    patchChunk(id, { status: "Review" });
    if (chunk?.source_file && finalizedFiles[chunk.source_file]) {
      unmarkFileFinalized(chunk.source_file);
    }
  };

  // Generate (and then review) this chunk's migration with Venice. When there's
  // specific guidance (a reject reason, or Fix with AI on a finding), this
  // keeps auto-regenerating on its own — using each round's fresh critical
  // issues as the next round's guidance — until the AI review comes back
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
    const targetProfile = state.targetProfile
      ? {
          language: state.targetProfile.language,
          version: state.targetProfile.version,
          test_framework: state.targetProfile.test_framework,
          notes: state.targetProfile.notes,
        }
      : null;
    const fileContext = state.files.find(
      (f) => f.filename === chunk.source_file,
    )?.content;

    // Loop-local state — the source of truth for control flow. Component
    // state (regenCounts) is only synced for the UI badge; reading it back
    // mid-loop would be stale since React batches updates across awaits.
    let attempts = regenCounts[chunk.id] ?? 0;
    let currentInstructions = instructions;
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
        // instead of rewriting blind — this is what makes a fix actually
        // stick instead of drifting on every round.
        const previousAttempt =
          currentInstructions && currentCode.trim() ? currentCode : undefined;

        const { migrated_code } = await generateMigration({
          name: chunk.name,
          sourceCode: chunk.source_code,
          businessRules,
          targetProfile,
          instructions: currentInstructions,
          previousAttempt,
          fileContext,
          projectManifest: projectManifest || undefined,
          lessonsLearned: lessonsLearned || undefined,
        });
        currentCode = migrated_code;
        // Clear the previous round's review/tests immediately — otherwise the
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
          }),
          generateTests({ name: chunk.name, migratedCode: migrated_code }),
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
            "Code generated, but the review/tests step failed — try again.",
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
          // Tests came back but review didn't — nothing to auto-fix against,
          // so stop here rather than looping blind.
          pushToast({
            variant: "info",
            title: `${chunk.name} generated — review step didn't return`,
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
          // clean — hand back to the human to approve
          pushToast({
            variant: "success",
            title: `${chunk.name} passed review`,
            description: "Ready for you to approve.",
            action: { label: "View chunk", onClick: () => jumpToChunk(chunk.id) },
          });
          break;
        }

        setRegenStatus(
          `Found ${criticalCount} critical issue${criticalCount === 1 ? "" : "s"} — auto-fixing…`,
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
          `Auto-fix tried ${MAX_REGENS} times on ${chunk.name} and couldn't clear every critical issue — please review the remaining findings manually.`,
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
      setBusyId(null);
      setRegenStatus(null);
      refreshQuota();
    }
  };

  const activeFileForContext = reviewChunk?.source_file
    ? state.files.find((f) => f.filename === reviewChunk.source_file)
    : undefined;

  const finalizeGroup = fileGroups.find((f) => f.filename === finalizeTarget) ?? null;

  // Only surface the header's background-job pill when the busy chunk isn't
  // the one already on screen — ChunkReview shows regenStatus inline there,
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
        approved={approved}
        total={state.chunks.length}
        onDownload={() => downloadProjectZip(repo, fileGroups)}
        canDownload={canDownloadZip}
        quotaRemaining={quota?.remaining ?? null}
        quotaMax={quota?.max ?? null}
        activeJob={activeJob}
        onJumpToJob={busyChunk ? () => jumpToChunk(busyChunk.id) : undefined}
      />

      <div className="min-h-0 flex-1">
        {view === "overview" ? (
          <div className="h-full overflow-y-auto">
            <OverviewPanel
              state={state}
              fileGroups={fileGroups}
              onFinalizeFile={(filename) => {
                const group = fileGroups.find((f) => f.filename === filename);
                if (group?.clusterReady) setFinalizeTarget(filename);
              }}
              onOpenBulkFinalize={() => setBulkFinalizeOpen(true)}
              lessons={lessons}
            />
          </div>
        ) : (
          <div className="flex h-full">
            <aside className="hidden w-72 shrink-0 border-r border-ink/10 md:block">
              <ChunkQueue
                chunks={state.chunks}
                selectedId={reviewChunk?.id ?? null}
                onSelect={setSelectedId}
                busyId={busyId}
              />
            </aside>
            <main className="min-w-0 flex-1">
              {explicit ? (
                <ChunkReview
                  chunk={explicit}
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
                  onDownloadZip={() => downloadProjectZip(repo, fileGroups)}
                />
              ) : reviewChunk ? (
                <ChunkReview
                  chunk={reviewChunk}
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
              className={`hidden shrink-0 border-l border-ink/10 transition-all duration-200 lg:block ${
                fileContextCollapsed ? "w-10" : "w-96"
              }`}
            >
              <FileContextPanel
                filename={reviewChunk?.source_file ?? ""}
                content={activeFileForContext?.content ?? ""}
                activeStartLine={reviewChunk?.start_line ?? 0}
                activeEndLine={reviewChunk?.end_line ?? 0}
                collapsed={fileContextCollapsed}
                onToggleCollapse={() => setFileContextCollapsed((v) => !v)}
              />
            </aside>
          </div>
        )}
      </div>

      {finalizeGroup && (
        <FileFinalizeModal
          open
          file={finalizeGroup}
          onClose={() => setFinalizeTarget(null)}
          onFinalize={() => {
            markFileFinalized(finalizeGroup.filename);
            setFinalizeTarget(null);
          }}
          onLessonLearned={addLesson}
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

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
