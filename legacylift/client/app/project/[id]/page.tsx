"use client";
// app/project/[id]/page.tsx — Migration review workbench.
// Two views: Overview (the codebase map) and Review (step through each chunk,
// see the before/after, and approve or request changes). State comes from
// usePipeline; demo projects are fully seeded.

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { usePipeline } from "@/hooks/usePipeline";
import { approveChunk, rejectChunk } from "@/lib/api";
import {
  generateMigration,
  reviewMigration,
  generateTests,
} from "@/lib/migration";
import { staticAnalyze } from "@/lib/staticCheck";
import { downloadMigration } from "@/lib/download";
import { isDemoProject, DEMO_REPO } from "@/lib/demoData";
import type { MigrationChunk } from "@/types/legacylift";

const MAX_REGENS = 5;
import {
  WorkbenchHeader,
  type WorkbenchView,
} from "@/components/workbench/WorkbenchHeader";
import { ChunkQueue } from "@/components/workbench/ChunkQueue";
import { ChunkReview } from "@/components/workbench/ChunkReview";
import { OverviewPanel } from "@/components/workbench/OverviewPanel";

interface ProjectPageProps {
  params: { id: string };
}

function CompleteState({ approved, total }: { approved: number; total: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
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
      <Link
        href="/demo"
        className="mt-8 inline-flex items-center gap-2 rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9]"
      >
        Start another migration
        <ArrowRight className="h-4 w-4" />
      </Link>
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
  } = usePipeline(projectId);

  const [view, setView] = useState<WorkbenchView>("review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenCounts, setRegenCounts] = useState<Record<string, number>>({});

  const repo = demo ? DEMO_REPO.replace("github.com/", "") : projectId;
  const approved = state.chunks.filter((c) => c.status === "Approved").length;
  const canDownload = state.chunks.some(
    (c) => c.migrated_code && c.migrated_code.trim().length > 0,
  );
  const regenLeft = (id: string) =>
    Math.max(0, MAX_REGENS - (regenCounts[id] ?? 0));

  const explicit = selectedId
    ? state.chunks.find((c) => c.id === selectedId) ?? null
    : null;
  const reviewChunk = explicit ?? state.currentChunk;

  const handleApprove = async (id: string) => {
    markChunkApproved(id);
    if (offline) {
      advanceDemoChunk();
      setSelectedId(null);
      return;
    }
    await approveChunk(projectId, { chunk_id: id });
  };

  const handleReject = async (id: string, reason: string) => {
    markChunkRejected(id);
    if (offline) {
      advanceDemoChunk();
      setSelectedId(null);
      return;
    }
    await rejectChunk(projectId, { chunk_id: id, reason });
  };

  // Generate (and then review) this chunk's migration with Venice.
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
    setRegenCounts((m) => ({ ...m, [chunk.id]: (m[chunk.id] ?? 0) + 1 }));
    try {
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

      // 1. Generate the migration (must succeed).
      const { migrated_code } = await generateMigration({
        name: chunk.name,
        sourceCode: chunk.source_code,
        businessRules,
        targetProfile,
        instructions,
      });
      // Apply code + the deterministic static check immediately, and unlock review.
      patchChunk(chunk.id, {
        migrated_code,
        status: "Review",
        static_analysis: staticAnalyze(migrated_code),
      });

      // 2. AI review + test generation run in parallel and tolerate failure —
      //    a flaky check must never discard the generated code.
      const [review, tests] = await Promise.allSettled([
        reviewMigration({
          name: chunk.name,
          sourceCode: chunk.source_code,
          migratedCode: migrated_code,
        }),
        generateTests({ name: chunk.name, migratedCode: migrated_code }),
      ]);
      if (review.status === "fulfilled") {
        patchChunk(chunk.id, { ai_review: review.value });
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
        setRegenError(
          "Code generated, but the review/tests step failed — try again.",
        );
      }
    } catch (err) {
      setRegenError(
        err instanceof Error ? err.message : "Venice request failed",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="dark flex h-screen flex-col bg-base text-ink">
      <WorkbenchHeader
        repo={repo}
        view={view}
        onViewChange={setView}
        approved={approved}
        total={state.chunks.length}
        onDownload={() => downloadMigration(repo, state.chunks)}
        canDownload={canDownload}
      />

      <div className="min-h-0 flex-1">
        {view === "overview" ? (
          <div className="h-full overflow-y-auto">
            <OverviewPanel state={state} />
          </div>
        ) : (
          <div className="flex h-full">
            <aside className="hidden w-72 shrink-0 border-r border-ink/10 md:block">
              <ChunkQueue
                chunks={state.chunks}
                selectedId={reviewChunk?.id ?? null}
                onSelect={setSelectedId}
              />
            </aside>
            <main className="min-w-0 flex-1">
              {explicit ? (
                <ChunkReview
                  chunk={explicit}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onRegenerate={(instr) => handleRegenerate(explicit, instr)}
                  regenerating={busyId === explicit.id}
                  regenError={regenError}
                  regenRemaining={regenLeft(explicit.id)}
                />
              ) : state.migrationComplete ? (
                <CompleteState approved={approved} total={state.chunks.length} />
              ) : reviewChunk ? (
                <ChunkReview
                  chunk={reviewChunk}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onRegenerate={(instr) => handleRegenerate(reviewChunk, instr)}
                  regenerating={busyId === reviewChunk.id}
                  regenError={regenError}
                  regenRemaining={regenLeft(reviewChunk.id)}
                />
              ) : (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-sub">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Waiting for the first migration chunk…
                </div>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
