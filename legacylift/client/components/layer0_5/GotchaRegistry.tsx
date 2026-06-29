"use client";
// GotchaRegistry — List of known migration pitfalls for the source language.
// Severity-coded: high (red), medium (amber), low (green).
// Populated by Layer 0.5 from fetched migration docs.
//
// TODO: Link each gotcha to the specific business rules it affects.
// TODO: Allow developers to mark a gotcha as "acknowledged" to clear the warning.

import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { GotchaEntry } from "@/types/legacylift";

const PLACEHOLDER_ENTRIES: GotchaEntry[] = [
  {
    id: "G-001",
    title: "Integer division loses cents",
    description:
      "COBOL COMPUTE uses decimal arithmetic by default. Python integer division truncates. Use Decimal for all monetary calculations.",
    severity: "high",
    affected_constructs: ["COMPUTE", "DIVIDE"],
  },
  {
    id: "G-002",
    title: "REDEFINES clause has no direct equivalent",
    description:
      "COBOL REDEFINES overlays memory. In Python, use a union type or a dataclass with Optional fields and explicit conversion.",
    severity: "high",
    affected_constructs: ["REDEFINES", "OCCURS"],
  },
  {
    id: "G-003",
    title: "Sign handling in packed-decimal (COMP-3)",
    description:
      "COMP-3 fields can carry a trailing sign nibble. Ensure your BCD parser handles both positive and negative packed decimals.",
    severity: "medium",
    affected_constructs: ["COMP-3", "PIC S9"],
  },
  {
    id: "G-004",
    title: "EBCDIC vs UTF-8 encoding",
    description:
      "Legacy data files are EBCDIC. Python reads UTF-8 by default. Specify encoding='cp037' (or the correct EBCDIC variant) when opening data files.",
    severity: "medium",
    affected_constructs: ["OPEN INPUT", "READ"],
  },
  {
    id: "G-005",
    title: "END-OF-FILE handling differs",
    description:
      "COBOL uses AT END clause on READ. Python raises StopIteration on exhausted iterators. Map COBOL EOF flag to a Python sentinel or exception.",
    severity: "low",
    affected_constructs: ["READ … AT END"],
  },
];

const SEVERITY_CONFIG = {
  high: { icon: AlertTriangle, colour: "#EF4444", bg: "#EF4444/10", border: "#EF4444/30" },
  medium: { icon: AlertCircle, colour: "#F59E0B", bg: "#F59E0B/10", border: "#F59E0B/30" },
  low: { icon: Info, colour: "#00C48C", bg: "#00C48C/10", border: "#00C48C/30" },
};

interface GotchaRegistryProps {
  entries?: GotchaEntry[];
}

export function GotchaRegistry({ entries }: GotchaRegistryProps) {
  const rows = entries ?? PLACEHOLDER_ENTRIES;

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Gotcha Registry</h2>
        {!entries && (
          <span className="text-xs text-[#444444]">placeholder</span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((entry) => {
          const cfg = SEVERITY_CONFIG[entry.severity];
          return (
            <div
              key={entry.id}
              className={`rounded-lg border p-4`}
              style={{ borderColor: cfg.colour + "30", background: cfg.colour + "08" }}
            >
              <div className="flex items-start gap-2">
                <cfg.icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: cfg.colour }} />
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-[#444444]">{entry.id}</span>
                    <span
                      className="text-xs font-semibold capitalize"
                      style={{ color: cfg.colour }}
                    >
                      {entry.severity}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-white">{entry.title}</p>
                  <p className="text-xs leading-relaxed text-[#888888]">{entry.description}</p>
                  {entry.affected_constructs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.affected_constructs.map((c) => (
                        <code
                          key={c}
                          className="rounded bg-[#222222] px-1.5 py-0.5 text-xs text-[#888888]"
                        >
                          {c}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
