"use client";
// ChunkQueue — the list of functions being migrated. Replaces the old "layer"
// sidebar with something concrete: the actual units of work, their status and
// risk, click to review.

import type { MigrationChunk } from "@/types/legacylift";
import {
  RiskBadge,
  StatusDot,
  STATUS_META,
  RISK_RANK,
} from "@/components/workbench/shared";

interface ChunkQueueProps {
  chunks: MigrationChunk[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ChunkQueue({ chunks, selectedId, onSelect }: ChunkQueueProps) {
  const approved = chunks.filter((c) => c.status === "Approved").length;
  const pct = chunks.length ? Math.round((approved / chunks.length) * 100) : 0;

  // Sort by attention: highest risk first, then by original order (stable).
  const ordered = chunks
    .map((c, i) => ({ c, i }))
    .sort(
      (a, b) =>
        RISK_RANK[b.c.risk_level] - RISK_RANK[a.c.risk_level] || a.i - b.i,
    )
    .map(({ c }) => c);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink/10 px-4 py-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Migration queue</h2>
          <span className="font-mono text-xs text-sub">
            {approved}/{chunks.length}
          </span>
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-[#7C3AED] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {ordered.map((chunk) => {
          const active = chunk.id === selectedId;
          return (
            <button
              key={chunk.id}
              onClick={() => onSelect(chunk.id)}
              className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                active ? "bg-[#7C3AED]/[0.12]" : "hover:bg-ink/[0.05]"
              }`}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[#7C3AED]" />
              )}
              <StatusDot status={chunk.status} />
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate font-mono text-[13px] ${
                    active ? "text-ink" : "text-ink/80"
                  }`}
                >
                  {chunk.name}
                </div>
                <div className="text-[11px] text-sub">
                  {STATUS_META[chunk.status].label}
                </div>
              </div>
              <RiskBadge level={chunk.risk_level} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
