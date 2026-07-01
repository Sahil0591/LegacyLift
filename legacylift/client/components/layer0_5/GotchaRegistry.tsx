"use client";
// GotchaRegistry — List of known migration pitfalls for the source language.
// Severity-coded: Critical (red), High (orange), Medium (yellow), Low (green).
// Populated by the target_profile_ready WebSocket event from Layer 0.5.

import { useState } from "react";
import type { Gotcha } from "@/types/legacylift";

const SEVERITY_COLOUR: Record<string, string> = {
  Critical: "#EF4444",
  High:     "#F97316",
  Medium:   "#F59E0B",
  Low:      "#00C48C",
};

interface GotchaRegistryProps {
  gotchas?: Gotcha[] | null;
}

export function GotchaRegistry({ gotchas }: GotchaRegistryProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  if (!gotchas) {
    return (
      <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Gotcha Registry</h2>
        <p className="text-xs text-[#444444]">Awaiting analysis...</p>
      </div>
    );
  }

  if (gotchas.length === 0) {
    return (
      <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Gotcha Registry</h2>
        <p className="text-xs text-[#444444]">No gotchas detected.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">Gotcha Registry</h2>

      <div className="flex flex-col gap-3">
        {gotchas.map((entry) => {
          const colour = SEVERITY_COLOUR[entry.severity] ?? "#888888";
          const isOpen = expanded[entry.id] ?? false;
          const hasDetails = !!(entry.cobol_example || entry.python_fix);

          return (
            <div
              key={entry.id}
              className="rounded-lg border p-4"
              style={{
                borderColor: colour + "30",
                background:  colour + "08",
              }}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[#444444]">{entry.id}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-semibold"
                    style={{ color: colour, background: colour + "18" }}
                  >
                    {entry.severity}
                  </span>
                </div>

                <p className="text-sm font-medium text-white">{entry.title}</p>
                <p className="text-xs leading-relaxed text-[#888888]">
                  {entry.description}
                </p>

                {hasDetails && (
                  <button
                    onClick={() => toggle(entry.id)}
                    className="mt-1 text-left text-xs text-[#444444] transition-colors hover:text-[#888888]"
                  >
                    {isOpen ? "▲ Hide details" : "▼ Show details"}
                  </button>
                )}

                {isOpen && (
                  <div className="mt-2 flex flex-col gap-2">
                    {entry.cobol_example && (
                      <div>
                        <p className="mb-1 text-xs text-[#888888]">COBOL</p>
                        <code className="block whitespace-pre-wrap rounded border border-[#222222] bg-[#0a0a0a] p-2 text-xs text-[#F59E0B]">
                          {entry.cobol_example}
                        </code>
                      </div>
                    )}
                    {entry.python_fix && (
                      <div>
                        <p className="mb-1 text-xs text-[#888888]">Python fix</p>
                        <code className="block whitespace-pre-wrap rounded border border-[#222222] bg-[#0a0a0a] p-2 text-xs text-[#00C48C]">
                          {entry.python_fix}
                        </code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
