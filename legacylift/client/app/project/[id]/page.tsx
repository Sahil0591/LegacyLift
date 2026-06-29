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
import { isDemoProject, DEMO_REPO } from "@/lib/demoData";
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

  const { state, markChunkApproved, markChunkRejected, advanceDemoChunk } =
    usePipeline(projectId);

  const [view, setView] = useState<WorkbenchView>("review");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const repo = demo ? DEMO_REPO.replace("github.com/", "") : projectId;
  const approved = state.chunks.filter((c) => c.status === "Approved").length;

  const explicit = selectedId
    ? state.chunks.find((c) => c.id === selectedId) ?? null
    : null;
  const reviewChunk = explicit ?? state.currentChunk;

  const handleApprove = async (id: string) => {
    markChunkApproved(id);
    if (demo) {
      advanceDemoChunk();
      setSelectedId(null);
      return;
    }
    await approveChunk(projectId, { chunk_id: id });
  };

  const handleReject = async (id: string, reason: string) => {
    markChunkRejected(id);
    if (demo) {
      advanceDemoChunk();
      setSelectedId(null);
      return;
    }
    await rejectChunk(projectId, { chunk_id: id, reason });
  };

  return (
    <div className="dark flex h-screen flex-col bg-base text-ink">
      <WorkbenchHeader
        repo={repo}
        view={view}
        onViewChange={setView}
        approved={approved}
        total={state.chunks.length}
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
                />
              ) : state.migrationComplete ? (
                <CompleteState approved={approved} total={state.chunks.length} />
              ) : reviewChunk ? (
                <ChunkReview
                  chunk={reviewChunk}
                  onApprove={handleApprove}
                  onReject={handleReject}
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
