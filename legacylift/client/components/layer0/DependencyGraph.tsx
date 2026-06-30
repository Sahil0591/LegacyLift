"use client";
// DependencyGraph — Interactive dependency graph with layered auto-layout,
// click-to-highlight connected paths, and an inline detail panel.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import type { DependencyGraph as DependencyGraphType } from "@/types/legacylift";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_COLOURS: Record<string, string> = {
  section:   "#7C3AED",
  paragraph: "#8B5CF6",
  copybook:  "#F59E0B",
  external:  "#6B7280",
};

const LAYER_GAP  = 240;
const NODE_GAP   = 90;

// ---------------------------------------------------------------------------
// Layout: topological sort → layered positions
// ---------------------------------------------------------------------------

function computePositions(
  graph: DependencyGraphType,
): Map<string, { x: number; y: number }> {
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of graph.edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    const ch = children.get(e.source) ?? [];
    ch.push(e.target);
    children.set(e.source, ch);
  }

  // BFS — each node is visited exactly once, so cycles are safe.
  // Nodes with no incoming edges start at layer 0; others get first-discovered layer.
  const layerOf = new Map<string, number>();
  const queue: string[] = [];

  for (const n of graph.nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      layerOf.set(n.id, 0);
      queue.push(n.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const layer = layerOf.get(id) ?? 0;
    for (const child of children.get(id) ?? []) {
      if (!layerOf.has(child)) {          // visit each node at most once → no cycles
        layerOf.set(child, layer + 1);
        queue.push(child);
      }
    }
  }
  // Fallback: nodes only reachable via cycles or truly isolated
  let maxSeen = 0;
  for (const l of layerOf.values()) if (l > maxSeen) maxSeen = l;
  for (const n of graph.nodes) {
    if (!layerOf.has(n.id)) layerOf.set(n.id, maxSeen + 1);
  }

  // Group by layer
  const byLayer = new Map<number, string[]>();
  for (const [id, l] of layerOf) {
    const arr = byLayer.get(l) ?? [];
    arr.push(id);
    byLayer.set(l, arr);
  }

  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of byLayer) {
    const totalH = (ids.length - 1) * NODE_GAP;
    ids.forEach((id, i) => {
      pos.set(id, { x: l * LAYER_GAP, y: i * NODE_GAP - totalH / 2 });
    });
  }
  return pos;
}

// ---------------------------------------------------------------------------
// ReactFlow node / edge builders
// ---------------------------------------------------------------------------

function buildNodes(graph: DependencyGraphType): Node[] {
  const pos = computePositions(graph);
  return graph.nodes.map((n) => {
    const colour = NODE_COLOURS[n.type] ?? "#888888";
    const { x, y } = pos.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      position: { x, y },
      data: { label: n.label, nodeType: n.type, file: n.file },
      style: {
        background: `${colour}22`,
        border: `1px solid ${colour}88`,
        color: "rgb(var(--c-text))",
        fontSize: "11px",
        padding: "6px 10px",
        borderRadius: "6px",
        minWidth: 110,
        textAlign: "center" as const,
        transition: "opacity 0.15s, box-shadow 0.15s",
      },
    };
  });
}

function buildEdges(graph: DependencyGraphType): Edge[] {
  return graph.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(148,148,160,0.5)" },
    style: { stroke: "rgba(148,148,160,0.35)", strokeWidth: 1.5 },
    labelStyle: { fontSize: 9, fill: "#9a9aa5" },
  }));
}

// ---------------------------------------------------------------------------
// Placeholder shown before real graph arrives
// ---------------------------------------------------------------------------

const PLACEHOLDER: DependencyGraphType = {
  nodes: [
    { id: "a", label: "CALC-INTEREST",  file: "interest.cbl",  type: "section" },
    { id: "b", label: "VALIDATE-ACCT",  file: "account.cbl",   type: "section" },
    { id: "c", label: "WRITE-OUTPUT",   file: "output.cbl",    type: "paragraph" },
    { id: "d", label: "COPYBOOK-RATES", file: "rates.cpy",     type: "copybook" },
    { id: "e", label: "DB2-INSERT",     file: "external",      type: "external" },
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "a", target: "d" },
    { source: "b", target: "c" },
    { source: "c", target: "e" },
  ],
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DependencyGraphProps {
  graph: DependencyGraphType | null;
}

export function DependencyGraph({ graph }: DependencyGraphProps) {
  const active = graph ?? PLACEHOLDER;
  const isPlaceholder = !graph;

  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node[]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Track browser fullscreen state
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Re-layout whenever the graph changes
  useEffect(() => {
    setNodes(buildNodes(active));
    setEdges(buildEdges(active));
    setSelectedId(null);
  }, [active.nodes.length, active.edges.length]); // eslint-disable-line

  // Sets of node/edge IDs connected to the selected node
  const connectedNodes = useMemo<Set<string> | null>(() => {
    if (!selectedId) return null;
    const ids = new Set<string>([selectedId]);
    for (const e of active.edges) {
      if (e.source === selectedId) ids.add(e.target);
      if (e.target === selectedId) ids.add(e.source);
    }
    return ids;
  }, [selectedId, active]);

  const connectedEdges = useMemo<Set<string> | null>(() => {
    if (!selectedId) return null;
    const ids = new Set<string>();
    active.edges.forEach((e, i) => {
      if (e.source === selectedId || e.target === selectedId) ids.add(`e-${i}`);
    });
    return ids;
  }, [selectedId, active]);

  // Apply highlight styles
  const styledNodes = useMemo(
    () =>
      nodes.map((n) => {
        const isSelected = n.id === selectedId;
        const isConnected = connectedNodes?.has(n.id) ?? true;
        return {
          ...n,
          style: {
            ...n.style,
            opacity: connectedNodes ? (isConnected ? 1 : 0.15) : 1,
            boxShadow: isSelected
              ? "0 0 0 2px #7C3AED, 0 0 14px #7C3AED44"
              : undefined,
            borderColor: isSelected ? "#7C3AED" : n.style?.borderColor,
          },
        };
      }),
    [nodes, connectedNodes, selectedId],
  );

  const styledEdges = useMemo(
    () =>
      edges.map((e) => {
        const isConnected = connectedEdges?.has(e.id) ?? true;
        return {
          ...e,
          style: {
            ...e.style,
            opacity: connectedEdges ? (isConnected ? 1 : 0.08) : 0.6,
            stroke: isConnected && connectedEdges
              ? "#7C3AED"
              : "rgba(148,148,160,0.35)",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color:
              isConnected && connectedEdges
                ? "#7C3AED"
                : "rgba(148,148,160,0.4)",
          },
        };
      }),
    [edges, connectedEdges],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      setSelectedId((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );

  const handlePaneClick = useCallback(() => setSelectedId(null), []);

  // Detail for the selected node
  const selectedNode = selectedId
    ? active.nodes.find((n) => n.id === selectedId)
    : null;
  const selectedOutgoing = selectedId
    ? active.edges.filter((e) => e.source === selectedId)
    : [];
  const selectedIncoming = selectedId
    ? active.edges.filter((e) => e.target === selectedId)
    : [];

  return (
    <div
      ref={containerRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-[9999] flex flex-col bg-base"
          : "overflow-hidden rounded-xl border border-ink/10 bg-surface/40"
      }
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">Dependency graph</h3>
          {isPlaceholder && (
            <span className="rounded-full border border-ink/15 bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium text-sub">
              preview
            </span>
          )}
          {selectedId && (
            <span className="rounded-full bg-[#7C3AED]/15 px-2 py-0.5 text-[10px] font-medium text-[#7C3AED]">
              {selectedId} · click again or canvas to clear
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-wrap gap-3">
            {Object.entries(NODE_COLOURS).map(([type, colour]) => (
              <div key={type} className="flex items-center gap-1 text-[11px] text-sub">
                <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
                {type}
              </div>
            ))}
          </div>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/15 bg-surface/60 text-sub transition-colors hover:border-[#7C3AED]/40 hover:text-[#7C3AED]"
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Graph canvas */}
      <div className={isFullscreen ? "flex-1" : "h-[380px] w-full"}>
        <ReactFlow
          nodes={styledNodes}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={3}
        >
          <Background color="rgba(148,148,160,0.12)" gap={16} />
          <Controls
            className="[&>button]:border-ink/20 [&>button]:bg-surface/80 [&>button]:text-ink/70"
            showInteractive={false}
          />
          <MiniMap
            nodeColor={(n) => {
              const type = (n.data as { nodeType?: string }).nodeType ?? "section";
              return NODE_COLOURS[type] ?? "#888888";
            }}
            maskColor="rgba(0,0,0,0.4)"
            pannable
            zoomable
            className="!bg-surface/80 !border-ink/15 rounded-lg overflow-hidden"
          />
        </ReactFlow>
      </div>

      {/* Selected node detail panel */}
      {selectedNode && (
        <div className="border-t border-ink/10 bg-surface/20 px-4 py-3">
          <div className="flex flex-wrap items-start gap-6 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-sub">Module</div>
              <div className="mt-0.5 font-mono font-semibold text-ink">
                {selectedNode.label}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-sub">Type</div>
              <div
                className="mt-0.5 font-medium capitalize"
                style={{ color: NODE_COLOURS[selectedNode.type] ?? "#888" }}
              >
                {selectedNode.type}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-sub">File</div>
              <div className="mt-0.5 font-mono text-ink/80">{selectedNode.file || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-sub">Calls</div>
              <div className="mt-0.5 text-ink/80">
                {selectedOutgoing.length > 0
                  ? selectedOutgoing.map((e) => e.target).join(", ")
                  : "none"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-sub">Called by</div>
              <div className="mt-0.5 text-ink/80">
                {selectedIncoming.length > 0
                  ? selectedIncoming.map((e) => e.source).join(", ")
                  : "none"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
