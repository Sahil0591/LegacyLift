"use client";
// OverviewPanel — the "we mapped your codebase" dashboard: headline numbers,
// risk distribution, the dependency graph, and the extracted business rules.

import { FileCode2, BookOpen, ShieldAlert, GitMerge } from "lucide-react";
import type { PipelineState } from "@/types/legacylift";
import { DependencyGraph } from "@/components/layer0/DependencyGraph";
import { RISK_META, scoreToLevel } from "@/components/workbench/shared";

function StatTile({
  Icon,
  value,
  label,
  color,
}: {
  Icon: typeof FileCode2;
  value: string | number;
  label: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-surface/40 p-4">
      <Icon className="h-4 w-4" style={{ color }} />
      <div className="mt-2 text-2xl font-bold text-ink">{value}</div>
      <div className="text-xs text-sub">{label}</div>
    </div>
  );
}

export function OverviewPanel({ state }: { state: PipelineState }) {
  const { businessRules, riskScores, dependencyGraph, chunks, targetProfile } =
    state;

  const scores = Object.values(riskScores);
  const avg = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
  const avgLevel = scoreToLevel(avg);
  const approved = chunks.filter((c) => c.status === "Approved").length;

  const counts = { Low: 0, Medium: 0, High: 0, Critical: 0 };
  for (const s of scores) counts[scoreToLevel(s)] += 1;
  const total = scores.length || 1;
  const order = ["Critical", "High", "Medium", "Low"] as const;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          Icon={FileCode2}
          value={dependencyGraph?.nodes.length ?? chunks.length}
          label="functions mapped"
          color="#7C3AED"
        />
        <StatTile
          Icon={BookOpen}
          value={businessRules.length}
          label="business rules extracted"
          color="#3B82F6"
        />
        <StatTile
          Icon={ShieldAlert}
          value={RISK_META[avgLevel].label}
          label="average risk"
          color={RISK_META[avgLevel].color}
        />
        <StatTile
          Icon={GitMerge}
          value={`${approved}/${chunks.length}`}
          label="chunks merged"
          color="#10B981"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Risk distribution */}
        <div className="rounded-xl border border-ink/10 bg-surface/40 p-5">
          <h3 className="text-sm font-semibold text-ink">Risk distribution</h3>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-ink/10">
            {order.map((level) =>
              counts[level] > 0 ? (
                <div
                  key={level}
                  style={{
                    width: `${(counts[level] / total) * 100}%`,
                    background: RISK_META[level].color,
                  }}
                />
              ) : null,
            )}
          </div>
          <div className="mt-4 space-y-2">
            {order.map((level) => (
              <div
                key={level}
                className="flex items-center gap-2 text-xs"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: RISK_META[level].color }}
                />
                <span className="text-sub">{level}</span>
                <span className="ml-auto font-mono text-ink/80">
                  {counts[level]}
                </span>
              </div>
            ))}
          </div>

          {targetProfile && (
            <div className="mt-5 border-t border-ink/10 pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-sub">
                Target
              </h4>
              <div className="mt-2 space-y-1.5 text-xs text-ink/80">
                <div className="flex justify-between gap-2">
                  <span className="text-sub">Language</span>
                  <span className="font-mono">
                    {targetProfile.language} {targetProfile.version}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-sub">Tests</span>
                  <span className="font-mono">
                    {targetProfile.test_framework}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-sub">Style</span>
                  <span className="truncate font-mono">
                    {targetProfile.style_guide}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Dependency graph */}
        <div className="lg:col-span-2">
          <DependencyGraph graph={dependencyGraph} />
        </div>
      </div>

      {/* Business rules */}
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
        <div className="flex items-center justify-between border-b border-ink/10 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Business rules</h3>
          <span className="font-mono text-xs text-sub">
            {businessRules.length} extracted
          </span>
        </div>
        <div className="divide-y divide-ink/[0.06]">
          {businessRules.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
            >
              <span className="text-sm font-medium text-ink">{rule.title}</span>
              <span className="font-mono text-xs text-sub">
                {rule.source_file}:{rule.source_lines[0]}–{rule.source_lines[1]}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] text-sub">
                  {rule.ownership_category}
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background:
                      rule.confidence === "High"
                        ? "#10B98120"
                        : rule.confidence === "Medium"
                          ? "#F59E0B20"
                          : "#6B728020",
                    color:
                      rule.confidence === "High"
                        ? "#10B981"
                        : rule.confidence === "Medium"
                          ? "#F59E0B"
                          : "#6B7280",
                  }}
                >
                  {rule.confidence}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
