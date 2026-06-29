"use client";
// DependencyGraph — Interactive visualisation of module dependencies using ReactFlow.
// Nodes are coloured by type (section/paragraph/copybook/external).
// Populated by the dependency_graph_ready WebSocket event.
//
// TODO: Add minimap and zoom controls (ReactFlow's MiniMap and Controls components).
// TODO: Colour edges by risk level: high-risk calls in red, safe calls in green.
// TODO: Click a node to highlight all connected paths and show a details panel.

import { useCallback } from "react";
import ReactFlow, {
  Background,
  type Edge,
  type Node,
  type NodeTypes,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import type { DependencyGraph as DependencyGraphType } from "@/types/legacylift";

const NODE_COLOURS: Record<string, string> = {
  section: "#7C3AED",
  paragraph: "#8B5CF6",
  copybook: "#F59E0B",
  external: "#6B7280",
};

function toRFNodes(graph: DependencyGraphType): Node[] {
  // Basic auto-layout: arrange in a grid. TODO: replace with dagre layout library.
  return graph.nodes.map((n, i) => ({
    id: n.id,
    position: { x: (i % 4) * 200, y: Math.floor(i / 4) * 120 },
    data: { label: n.label },
    style: {
      background: `${NODE_COLOURS[n.type] ?? "#888888"}22`,
      border: `1px solid ${NODE_COLOURS[n.type] ?? "#888888"}`,
      color: "#fff",
      fontSize: "11px",
      padding: "6px 10px",
      borderRadius: "6px",
    },
  }));
}

function toRFEdges(graph: DependencyGraphType): Edge[] {
  return graph.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    label: e.label,
    style: { stroke: "rgba(148,148,160,0.35)" },
    labelStyle: { fontSize: 9, fill: "#9a9aa5" },
  }));
}

// Placeholder graph shown before the real one arrives
const PLACEHOLDER: DependencyGraphType = {
  nodes: [
    { id: "a", label: "CALC-INTEREST", file: "interest.cbl", type: "section" },
    { id: "b", label: "VALIDATE-ACCT", file: "account.cbl", type: "section" },
    { id: "c", label: "WRITE-OUTPUT", file: "output.cbl", type: "paragraph" },
    { id: "d", label: "COPYBOOK-RATES", file: "rates.cpy", type: "copybook" },
    { id: "e", label: "DB2-INSERT", file: "external", type: "external" },
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "a", target: "d" },
    { source: "b", target: "c" },
    { source: "c", target: "e" },
  ],
};

const nodeTypes: NodeTypes = {};

interface DependencyGraphProps {
  graph: DependencyGraphType | null;
}

export function DependencyGraph({ graph }: DependencyGraphProps) {
  const activeGraph = graph ?? PLACEHOLDER;
  const [nodes, , onNodesChange] = useNodesState(toRFNodes(activeGraph));
  const [edges, , onEdgesChange] = useEdgesState(toRFEdges(activeGraph));

  const onInit = useCallback(() => {}, []);

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">Dependency graph</h3>
        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {Object.entries(NODE_COLOURS).map(([type, colour]) => (
            <div
              key={type}
              className="flex items-center gap-1 text-[11px] text-sub"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: colour }}
              />
              {type}
            </div>
          ))}
        </div>
      </div>

      <div className="h-[340px] w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onInit={onInit}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(148,148,160,0.18)" gap={16} />
        </ReactFlow>
      </div>
    </div>
  );
}
