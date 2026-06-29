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
  section: "#2563EB",
  paragraph: "#7C3AED",
  copybook: "#F59E0B",
  external: "#888888",
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
    style: { stroke: "#333333" },
    labelStyle: { fontSize: 9, fill: "#888888" },
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
    <div className="rounded-xl border border-[#222222] bg-[#111111] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#222222]">
        <h2 className="text-sm font-semibold text-white">Dependency Graph</h2>
        {!graph && (
          <span className="text-xs text-[#444444]">placeholder — waiting for Layer 0</span>
        )}
        {/* Legend */}
        <div className="flex gap-3">
          {Object.entries(NODE_COLOURS).map(([type, colour]) => (
            <div key={type} className="flex items-center gap-1 text-xs text-[#888888]">
              <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
              {type}
            </div>
          ))}
        </div>
      </div>

      <div className="h-[400px] w-full">
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
          <Background color="#222222" gap={16} />
        </ReactFlow>
      </div>
    </div>
  );
}
