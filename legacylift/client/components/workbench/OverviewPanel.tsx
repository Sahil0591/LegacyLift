"use client";
// OverviewPanel — the "we mapped your codebase" dashboard: headline numbers,
// risk distribution, the dependency graph, and the extracted business rules.

import { useState } from "react";
import {
  FileCode2,
  BookOpen,
  ShieldAlert,
  GitMerge,
  Download,
  CheckCircle2,
  Layers,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { PipelineState } from "@/types/legacylift";
import { DependencyGraph } from "@/components/layer0/DependencyGraph";
import { RISK_META, RiskBadge, scoreToLevel } from "@/components/workbench/shared";
import type { FileGroup, FileStatus } from "@/hooks/useFileStatus";
import type { Lesson } from "@/lib/lessons";
import { downloadSingleFile } from "@/lib/download";

const FILE_STATUS_META: Record<FileStatus, { label: string; color: string }> = {
  in_progress: { label: "In progress", color: "#6B7280" },
  ready_to_finalize: { label: "Ready to finalize", color: "#F59E0B" },
  finalizing: { label: "Finalizing…", color: "#7C3AED" },
  finalized: { label: "Finalized", color: "#10B981" },
};

function FileRow({
  group,
  onFinalize,
}: {
  group: FileGroup;
  onFinalize: () => void;
}) {
  const meta = FILE_STATUS_META[group.status];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
      <span className="font-mono text-sm font-medium text-ink">{group.filename}</span>
      {group.language && (
        <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] text-sub">
          {group.language}
        </span>
      )}
      <span className="font-mono text-xs text-sub">
        {group.approvedCount}/{group.totalCount} units
      </span>
      <RiskBadge level={group.riskLevel} />
      <div className="ml-auto flex items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: `${meta.color}1f`, color: meta.color }}
        >
          {meta.label}
        </span>
        {group.status === "ready_to_finalize" && (
          <button
            onClick={onFinalize}
            disabled={!group.clusterReady}
            title={
              group.clusterReady
                ? undefined
                : `Waiting on: ${group.blockedBy.join(", ")}`
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/30 px-2.5 py-1 text-[11px] font-semibold text-[#7C3AED] transition-colors hover:bg-[#7C3AED]/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCircle2 className="h-3 w-3" />
            {group.clusterReady ? "Finalize" : "Waiting on linked files"}
          </button>
        )}
        {group.status === "finalized" && (
          <button
            onClick={() => downloadSingleFile(group)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 py-1 text-[11px] font-semibold text-ink/80 transition-colors hover:bg-ink/[0.06]"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
        )}
      </div>
    </div>
  );
}

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

export function OverviewPanel({
  state,
  fileGroups,
  onFinalizeFile,
  onOpenBulkFinalize,
  lessons = [],
}: {
  state: PipelineState;
  fileGroups: FileGroup[];
  onFinalizeFile: (filename: string) => void;
  onOpenBulkFinalize?: () => void;
  lessons?: Lesson[];
}) {
  const { businessRules, riskScores, dependencyGraph, chunks, targetProfile } =
    state;
  const [lessonsOpen, setLessonsOpen] = useState(false);

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
      <div data-tour="stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      {/* Files */}
      <div data-tour="files" className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
        <div className="flex items-center justify-between border-b border-ink/10 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">Files</h3>
          <div className="flex items-center gap-3">
            {onOpenBulkFinalize &&
              fileGroups.some((f) => f.status === "ready_to_finalize" && f.clusterReady) && (
                <button
                  onClick={onOpenBulkFinalize}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/30 px-2.5 py-1 text-[11px] font-semibold text-[#7C3AED] transition-colors hover:bg-[#7C3AED]/10"
                >
                  <Layers className="h-3 w-3" />
                  Finalize all ready
                </button>
              )}
            <span className="font-mono text-xs text-sub">
              {fileGroups.filter((f) => f.status === "finalized").length}/
              {fileGroups.length} finalized
            </span>
          </div>
        </div>
        <div className="divide-y divide-ink/[0.06]">
          {fileGroups.length === 0 ? (
            <div className="px-5 py-4 text-xs text-sub">No files yet.</div>
          ) : (
            fileGroups.map((group) => (
              <FileRow
                key={group.filename}
                group={group}
                onFinalize={() => onFinalizeFile(group.filename)}
              />
            ))
          )}
        </div>
      </div>

      {/* Lessons learned — the feedback loop's memory, made visible */}
      {lessons.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
          <button
            onClick={() => setLessonsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3"
          >
            <span className="text-sm font-semibold text-ink">Lessons learned</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-sub">{lessons.length} captured</span>
              {lessonsOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-sub" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-sub" />
              )}
            </span>
          </button>
          {lessonsOpen && (
            <div className="divide-y divide-ink/[0.06] border-t border-ink/10">
              {[...lessons].reverse().map((l) => (
                <div key={l.id} className="flex items-start gap-2 px-5 py-2.5 text-xs">
                  <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] text-sub">
                    {l.source}
                  </span>
                  <span className="flex-1 text-ink/70">
                    {l.sourceFile && (
                      <span className="font-mono text-sub">{l.sourceFile}: </span>
                    )}
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Risk distribution */}
        <div data-tour="risk" className="rounded-xl border border-ink/10 bg-surface/40 p-5">
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
        <div data-tour="graph" className="lg:col-span-2">
          <DependencyGraph graph={dependencyGraph} />
        </div>
      </div>

      {/* Business rules */}
      <div data-tour="rules" className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
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
