"use client";
// ProgressSidebar — Left panel on the project workbench showing pipeline progress.
// Each layer is a collapsible section with sub-steps. Active layer is highlighted
// in blue; completed layers show a green tick; pending layers are greyed out.
//
// TODO: Make each completed layer clickable to show a read-only summary of its output.

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { WebSocketStatus } from "@/components/shared/WebSocketStatus";
import type { ConnectionStatus, PipelineLayer } from "@/types/legacylift";

interface LayerDef {
  id: PipelineLayer;
  label: string;
  subSteps: string[];
}

const LAYERS: LayerDef[] = [
  {
    id: 0,
    label: "Layer 0 — Archaeology",
    subSteps: [
      "Parse source files",
      "Extract business rules",
      "Build dependency graph",
      "Score risk per chunk",
    ],
  },
  {
    id: 0.5,
    label: "Layer 0.5 — Target Profile",
    subSteps: [
      "Fetch migration docs",
      "Map deprecations",
      "Register gotchas",
    ],
  },
  {
    id: 1,
    label: "Layer 1 — Static Analysis",
    subSteps: ["Syntax check", "Type completeness", "Complexity score"],
  },
  {
    id: 2,
    label: "Layer 2 — AI Review",
    subSteps: ["Semantic equivalence", "Edge case check", "Style review"],
  },
  {
    id: 3,
    label: "Layer 3 — Test Generation",
    subSteps: ["Generate test cases", "Run pytest", "Coverage check"],
  },
  {
    id: 4,
    label: "Layer 4 — Integration Tests",
    subSteps: ["Full integration suite", "Regression check", "Final report"],
  },
];

type LayerState = "pending" | "active" | "complete";

function layerState(layerId: PipelineLayer, current: PipelineLayer): LayerState {
  if (layerId < current) return "complete";
  if (layerId === current) return "active";
  return "pending";
}

interface ProgressSidebarProps {
  currentLayer: PipelineLayer;
  wsStatus: ConnectionStatus;
}

export function ProgressSidebar({ currentLayer, wsStatus }: ProgressSidebarProps) {
  return (
    <aside className="flex h-full flex-col justify-between border-r border-[#222222] bg-[#0a0a0a] p-4">
      <div className="flex flex-col gap-1">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#444444]">
          Pipeline
        </p>

        {LAYERS.map((layer) => {
          const state = layerState(layer.id, currentLayer);
          return (
            <div key={String(layer.id)} className="mb-2">
              {/* Layer header */}
              <div
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  state === "active"
                    ? "bg-[#2563EB]/10 text-white"
                    : state === "complete"
                    ? "text-[#00C48C]"
                    : "text-[#444444]"
                }`}
              >
                {state === "complete" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#00C48C]" />
                ) : state === "active" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#2563EB]" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-[#333333]" />
                )}
                <span className="font-medium">{layer.label}</span>
              </div>

              {/* Sub-steps — only shown for active layer */}
              {state === "active" && (
                <div className="ml-9 mt-1 flex flex-col gap-1">
                  {layer.subSteps.map((step) => (
                    <span key={step} className="text-xs text-[#888888]">
                      · {step}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* WebSocket status dot at bottom of sidebar */}
      <div className="border-t border-[#222222] pt-4">
        <WebSocketStatus status={wsStatus} />
      </div>
    </aside>
  );
}
