"use client";
// ArchaeologyReport - Summary card shown at the top of the Layer 0 view.
// Displays total rules found, files parsed, and risk distribution at a glance.
// Populated by the archaeology_complete WebSocket event.
//
// TODO: Add a "Download report" button that exports findings as a JSON/PDF.

import { FileCode2, BookOpen, ShieldAlert, TrendingUp } from "lucide-react";

interface ArchaeologyReportProps {
  totalFiles: number;
  totalRules: number;
  riskScores: Record<string, number>;
  complete: boolean;
}

function avgRisk(scores: Record<string, number>): string {
  const values = Object.values(scores);
  if (values.length === 0) return "N/A";
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg >= 0.8) return "Critical";
  if (avg >= 0.6) return "High";
  if (avg >= 0.35) return "Medium";
  return "Low";
}

const RISK_COLOUR: Record<string, string> = {
  Critical: "text-[#7C3AED]",
  High: "text-[#EF4444]",
  Medium: "text-[#F59E0B]",
  Low: "text-[#00C48C]",
  "N/A": "text-[#888888]",
};

export function ArchaeologyReport({
  totalFiles,
  totalRules,
  riskScores,
  complete,
}: ArchaeologyReportProps) {
  const risk = avgRisk(riskScores);

  const stats = [
    { icon: FileCode2, label: "Files parsed", value: totalFiles, colour: "text-[#2563EB]" },
    { icon: BookOpen, label: "Rules extracted", value: totalRules, colour: "text-[#00C48C]" },
    { icon: ShieldAlert, label: "Avg risk", value: risk, colour: RISK_COLOUR[risk] },
    { icon: TrendingUp, label: "Modules scored", value: Object.keys(riskScores).length, colour: "text-[#F59E0B]" },
  ];

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Archaeology Report</h2>
        {complete ? (
          <span className="rounded-full bg-[#00C48C]/10 px-2.5 py-0.5 text-xs text-[#00C48C]">
            Complete
          </span>
        ) : (
          <span className="rounded-full bg-[#2563EB]/10 px-2.5 py-0.5 text-xs text-[#2563EB] animate-pulse">
            Running…
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <stat.icon className={`h-4 w-4 ${stat.colour}`} />
            <span className={`text-2xl font-bold ${stat.colour}`}>
              {stat.value}
            </span>
            <span className="text-xs text-[#888888]">{stat.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
