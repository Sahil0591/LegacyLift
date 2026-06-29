"use client";
// LayerStatus — Compact status strip above the main content area showing
// which layer is currently running and a one-line description of what it's doing.
// Updates in real time as WebSocket events arrive.
//
// TODO: Add estimated time remaining based on historical average per layer.

import { Loader2 } from "lucide-react";
import type { PipelineLayer } from "@/types/legacylift";

const LAYER_DESCRIPTIONS: Record<string, string> = {
  "0": "Reading your codebase and extracting business rules…",
  "0.5": "Fetching migration documentation and mapping deprecations…",
  "1": "Running static analysis on migrated chunk…",
  "2": "AI is reviewing semantic equivalence of migrated code…",
  "3": "Generating and running auto-tests…",
  "4": "Running full integration test suite…",
};

interface LayerStatusProps {
  currentLayer: PipelineLayer;
  chunkName?: string;
}

export function LayerStatus({ currentLayer, chunkName }: LayerStatusProps) {
  const description = LAYER_DESCRIPTIONS[String(currentLayer)] ?? "Initialising pipeline…";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#222222] bg-[#111111] px-4 py-3">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#2563EB]" />
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-[#2563EB]">
          Layer {currentLayer}
          {chunkName && ` — ${chunkName}`}
        </span>
        <span className="text-sm text-[#888888]">{description}</span>
      </div>
    </div>
  );
}
