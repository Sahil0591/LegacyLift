"use client";
// DeprecationMap - Table mapping legacy constructs to their Python equivalents.
// Populated by the target_profile_ready WebSocket event from Layer 0.5.

import type { DeprecatedPattern } from "@/types/legacylift";

const RISK_COLOUR: Record<string, string> = {
  Critical: "#EF4444",
  High:     "#F97316",
  Medium:   "#F59E0B",
  Low:      "#00C48C",
};

interface DeprecationMapProps {
  patterns?: DeprecatedPattern[] | null;
}

export function DeprecationMap({ patterns }: DeprecationMapProps) {
  if (!patterns) {
    return (
      <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Deprecation Map</h2>
        <p className="text-xs text-[#444444]">Awaiting analysis...</p>
      </div>
    );
  }

  if (patterns.length === 0) {
    return (
      <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Deprecation Map</h2>
        <p className="text-xs text-[#444444]">No deprecated patterns detected.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">Deprecation Map</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#222222] text-left text-[#888888]">
              <th className="pb-2 pr-4 font-medium">Legacy construct</th>
              <th className="pb-2 pr-4 font-medium">Python equivalent</th>
              <th className="pb-2 pr-3 font-medium">Risk</th>
              <th className="pb-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((entry, i) => {
              const colour = RISK_COLOUR[entry.risk] ?? "#888888";
              return (
                <tr
                  key={i}
                  className="border-b border-[#1a1a1a] transition-colors hover:bg-[#1a1a1a]"
                >
                  <td className="py-2.5 pr-4">
                    <code className="text-[#F59E0B]">{entry.cobol_pattern}</code>
                  </td>
                  <td className="py-2.5 pr-4">
                    <code className="text-[#00C48C]">{entry.python_equivalent}</code>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className="rounded px-1.5 py-0.5 text-xs font-semibold"
                      style={{ color: colour, background: colour + "18" }}
                    >
                      {entry.risk}
                    </span>
                  </td>
                  <td className="py-2.5 text-[#888888]">{entry.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
