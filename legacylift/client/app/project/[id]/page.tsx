"use client";
// app/project/[id]/page.tsx — Main workbench. Three-column layout:
//   Left:   ProgressSidebar — pipeline layer navigation
//   Middle: Layer-specific content (Layer 0 rules → Layer 0.5 profile → Migration diff)
//   Right:  ApprovalControls — review actions for current chunk
//
// All state flows from usePipeline which subscribes to WebSocket events.
// The middle content switches purely on pipelineState.currentLayer.
//
// TODO: Add a top "breadcrumb" bar showing project name and total chunk progress.
// TODO: Add keyboard shortcuts (A/R/P) for approve/reject/pause.

import { Navbar } from "@/components/shared/Navbar";
import { ProgressSidebar } from "@/components/pipeline/ProgressSidebar";
import { LayerStatus } from "@/components/pipeline/LayerStatus";
import { ApprovalControls } from "@/components/pipeline/ApprovalControls";
import { ArchaeologyReport } from "@/components/layer0/ArchaeologyReport";
import { BusinessRuleList } from "@/components/layer0/BusinessRuleList";
import { DependencyGraph } from "@/components/layer0/DependencyGraph";
import { RiskScorePanel } from "@/components/layer0/RiskScorePanel";
import { TargetProfile } from "@/components/layer0_5/TargetProfile";
import { DeprecationMap } from "@/components/layer0_5/DeprecationMap";
import { GotchaRegistry } from "@/components/layer0_5/GotchaRegistry";
import { ChunkDiffViewer } from "@/components/migration/ChunkDiffViewer";
import { TestResults } from "@/components/migration/TestResults";
import { AIReviewPanel } from "@/components/migration/AIReviewPanel";
import { MigrationComplete } from "@/components/migration/MigrationComplete";
import { usePipeline } from "@/hooks/usePipeline";
import { approveChunk, rejectChunk, updateBusinessRule } from "@/lib/api";
import type { RuleStatus } from "@/types/legacylift";

interface ProjectPageProps {
  params: { id: string };
}

export default function ProjectPage({ params }: ProjectPageProps) {
  const projectId = params.id;

  const {
    state,
    wsStatus,
    markChunkApproved,
    markChunkRejected,
    updateRule,
  } = usePipeline(projectId);

  // ------------------------------------------------------------------
  // Approval handlers
  // ------------------------------------------------------------------

  const handleApprove = async (chunkId: string) => {
    markChunkApproved(chunkId);
    await approveChunk(projectId, { chunk_id: chunkId });
  };

  const handleReject = async (chunkId: string, reason: string) => {
    markChunkRejected(chunkId);
    await rejectChunk(projectId, { chunk_id: chunkId, reason });
  };

  const handleRuleStatusChange = async (ruleId: string, newStatus: RuleStatus) => {
    updateRule(ruleId, { status: newStatus });
    await updateBusinessRule(projectId, ruleId, { status: newStatus });
  };

  // ------------------------------------------------------------------
  // Middle content — switches on pipeline layer
  // ------------------------------------------------------------------

  function MiddleContent() {
    if (state.migrationComplete) {
      return (
        <MigrationComplete
          projectId={projectId}
          totalChunks={state.chunks.length}
          approvedChunks={state.chunks.filter((c) => c.status === "Approved").length}
        />
      );
    }

    if (state.currentLayer === 0) {
      return (
        <div className="flex flex-col gap-6">
          <LayerStatus currentLayer={0} />
          <ArchaeologyReport
            totalFiles={new Set(state.businessRules.map((r) => r.source_file)).size}
            totalRules={state.businessRules.length}
            riskScores={state.riskScores}
            complete={Object.keys(state.riskScores).length > 0}
          />
          <BusinessRuleList
            rules={state.businessRules}
            onStatusChange={handleRuleStatusChange}
          />
          <DependencyGraph graph={state.dependencyGraph} />
          <RiskScorePanel scores={state.riskScores} />
        </div>
      );
    }

    if (state.currentLayer === 0.5) {
      return (
        <div className="flex flex-col gap-6">
          <LayerStatus currentLayer={0.5} />
          <TargetProfile profile={state.targetProfile} />
          <DeprecationMap />
          <GotchaRegistry />
        </div>
      );
    }

    // Layers 1–3: migration review
    return (
      <div className="flex flex-col gap-6">
        <LayerStatus
          currentLayer={state.currentLayer}
          chunkName={state.currentChunk?.name}
        />
        <ChunkDiffViewer chunk={state.currentChunk} />
        {state.currentLayer >= 2 && (
          <AIReviewPanel review={state.currentChunk?.ai_review ?? null} />
        )}
        {state.currentLayer >= 3 && (
          <TestResults
            results={state.currentChunk?.test_results ?? []}
            running={state.currentLayer === 3}
          />
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="dark min-h-screen bg-[#0a0a0a] text-white">
      <Navbar wsStatus={wsStatus} projectId={projectId} />
      <div className="flex h-[calc(100vh-56px)] overflow-hidden">
        {/* Left — Progress sidebar */}
        <div className="w-56 shrink-0 overflow-y-auto">
          <ProgressSidebar currentLayer={state.currentLayer} wsStatus={wsStatus} />
        </div>

        {/* Middle — Main content */}
        <main className="flex-1 overflow-y-auto border-x border-[#222222] p-6">
          {state.error && (
            <div className="mb-4 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
              Pipeline error: {state.error}
            </div>
          )}
          <MiddleContent />
        </main>

        {/* Right — Approval controls */}
        <div className="w-72 shrink-0 overflow-y-auto p-4">
          {state.currentChunk && !state.migrationComplete ? (
            <ApprovalControls
              chunkId={state.currentChunk.id}
              chunkName={state.currentChunk.name}
              status={state.currentChunk.status}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ) : (
            <div className="rounded-xl border border-[#222222] bg-[#111111] p-5 text-center">
              <p className="text-xs text-[#444444]">
                {state.migrationComplete
                  ? "Migration complete — no more chunks to review."
                  : "Approval controls appear here when a chunk is ready for review."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
