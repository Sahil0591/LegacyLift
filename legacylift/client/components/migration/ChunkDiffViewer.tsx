"use client";
// ChunkDiffViewer — Side-by-side diff of legacy source (left) vs migrated Python (right).
// Uses react-diff-viewer-continued with a dark theme matching the design system.
// Populated by chunk_ready_for_approval WebSocket event.
//
// TODO: Add line-level commenting so reviewers can annotate specific diff lines.
// TODO: Show a "View full file" toggle to see context beyond the chunk boundary.

import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { MigrationChunk } from "@/types/legacylift";

const PLACEHOLDER_CHUNK: MigrationChunk = {
  id: "chunk-placeholder",
  name: "CALC-INTEREST-SECTION",
  source_file: "interest.cbl",
  start_line: 1,
  end_line: 8,
  source_code: `       CALC-INTEREST-SECTION.
           COMPUTE WS-INTEREST ROUNDED =
               WS-BALANCE * WS-RATE / 100
           IF WS-INTEREST < 0
               MOVE 0 TO WS-INTEREST
           END-IF
           ADD WS-INTEREST TO WS-TOTAL.
       CALC-INTEREST-EXIT.
           EXIT.
* TODO: real COBOL will come from the backend`,
  migrated_code: `def calc_interest(balance: Decimal, rate: Decimal) -> Decimal:
    # TODO: Layer 1-3 will generate real Python migration here
    interest = (balance * rate / Decimal("100")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return max(interest, Decimal("0"))`,
  diff: "",
  risk_level: "Medium",
  status: "Review",
  retry_count: 0,
  test_results: [],
  static_analysis: null,
  ai_review: null,
};

const DIFF_STYLES = {
  variables: {
    dark: {
      diffViewerBackground: "#0a0a0a",
      diffViewerColor: "#FFFFFF",
      addedBackground: "#00C48C11",
      addedColor: "#00C48C",
      removedBackground: "#EF444411",
      removedColor: "#EF4444",
      wordAddedBackground: "#00C48C33",
      wordRemovedBackground: "#EF444433",
      addedGutterBackground: "#00C48C0a",
      removedGutterBackground: "#EF44440a",
      gutterBackground: "#111111",
      gutterBackgroundDark: "#0a0a0a",
      highlightBackground: "#2563EB22",
      highlightGutterBackground: "#2563EB11",
      codeFoldGutterBackground: "#111111",
      codeFoldBackground: "#111111",
      emptyLineBackground: "#0a0a0a",
      gutterColor: "#444444",
      addedGutterColor: "#00C48C",
      removedGutterColor: "#EF4444",
      codeFoldContentColor: "#888888",
      diffViewerTitleBackground: "#111111",
      diffViewerTitleColor: "#888888",
      diffViewerTitleBorderColor: "#222222",
    },
  },
};

interface ChunkDiffViewerProps {
  chunk: MigrationChunk | null;
}

export function ChunkDiffViewer({ chunk }: ChunkDiffViewerProps) {
  const active = chunk ?? PLACEHOLDER_CHUNK;
  const isPlaceholder = !chunk;

  return (
    <div className="rounded-xl border border-[#222222] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#222222] bg-[#111111] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white">{active.name}</span>
          <StatusBadge value={active.risk_level} />
          {isPlaceholder && (
            <span className="text-xs text-[#444444]">placeholder</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-[#888888]">
          {active.retry_count > 0 && (
            <span className="rounded bg-[#F59E0B]/10 px-2 py-0.5 text-[#F59E0B]">
              Retry #{active.retry_count}
            </span>
          )}
          <span>Chunk {active.id}</span>
        </div>
      </div>

      {/* Diff viewer */}
      <div className="overflow-auto text-xs">
        <ReactDiffViewer
          oldValue={active.source_code}
          newValue={active.migrated_code}
          splitView={true}
          leftTitle="Legacy COBOL"
          rightTitle="Migrated Python"
          useDarkTheme={true}
          compareMethod={DiffMethod.WORDS}
          styles={DIFF_STYLES}
          hideLineNumbers={false}
        />
      </div>
    </div>
  );
}
