"use client";
// ChunkQueue - the list of functions being migrated, grouped VSCode-explorer
// style: one collapsible "folder" per source file, chunks nested underneath.
// A search box + risk/complexity filters narrow it down across every folder.

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { MigrationChunk, RiskLevel } from "@/types/legacylift";
import {
  RiskBadge,
  RISK_META,
  StatusDot,
  STATUS_META,
  RISK_RANK,
} from "@/components/workbench/shared";

interface ChunkQueueProps {
  chunks: MigrationChunk[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Chunk currently generating/testing in the background, if any. */
  busyId?: string | null;
}

const UNGROUPED = "(ungrouped)";
const RISK_LEVELS: RiskLevel[] = ["Critical", "High", "Medium", "Low"];

function worstRisk(chunks: MigrationChunk[]): RiskLevel {
  return chunks.reduce<RiskLevel>(
    (worst, c) => (RISK_RANK[c.risk_level] > RISK_RANK[worst] ? c.risk_level : worst),
    "Low",
  );
}

export function ChunkQueue({ chunks, selectedId, onSelect, busyId = null }: ChunkQueueProps) {
  const approved = chunks.filter((c) => c.status === "Approved").length;
  const pct = chunks.length ? Math.round((approved / chunks.length) * 100) : 0;

  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [riskFilter, setRiskFilter] = useState<Set<RiskLevel>>(new Set());
  const [minComplexity, setMinComplexity] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleRisk = (level: RiskLevel) =>
    setRiskFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });

  const toggleFolder = (filename: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });

  // Keep the folder containing the active chunk expanded when selection changes.
  useEffect(() => {
    if (!selectedId) return;
    const chunk = chunks.find((c) => c.id === selectedId);
    const filename = chunk?.source_file || UNGROUPED;
    setCollapsed((prev) => {
      if (!prev.has(filename)) return prev;
      const next = new Set(prev);
      next.delete(filename);
      return next;
    });
  }, [selectedId, chunks]);

  const minComplexityNum = minComplexity.trim() ? Number(minComplexity) : null;
  const hasActiveFilters =
    search.trim().length > 0 || riskFilter.size > 0 || minComplexityNum != null;

  const matches = (c: MigrationChunk) => {
    if (search.trim() && !c.name.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    if (riskFilter.size > 0 && !riskFilter.has(c.risk_level)) return false;
    if (minComplexityNum != null) {
      const complexity = c.static_analysis?.complexity_score;
      if (complexity == null || complexity < minComplexityNum) return false;
    }
    return true;
  };

  const folders = useMemo(() => {
    const byFile = new Map<string, MigrationChunk[]>();
    for (const c of chunks) {
      const key = c.source_file || UNGROUPED;
      const list = byFile.get(key) ?? [];
      list.push(c);
      byFile.set(key, list);
    }
    const byLine = (a: MigrationChunk, b: MigrationChunk) => a.start_line - b.start_line;
    return [...byFile.entries()]
      .map(([filename, all]) => ({
        filename,
        all: [...all].sort(byLine),
        filtered: all.filter(matches).sort(byLine),
      }))
      .filter((f) => f.filtered.length > 0)
      .sort((a, b) => a.filename.localeCompare(b.filename));
  }, [chunks, search, riskFilter, minComplexity]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink/10 px-4 py-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Migration queue</h2>
          <span className="font-mono text-xs text-sub">
            {approved}/{chunks.length}
          </span>
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-[#7C3AED] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="space-y-2 border-b border-ink/10 p-2.5">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sub/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chunks…"
              className="w-full rounded-lg border border-ink/12 bg-surface/40 py-1.5 pl-8 pr-2 text-xs text-ink outline-none placeholder:text-sub/50 focus:border-[#7C3AED]"
            />
          </div>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            title="Filter by risk / complexity"
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              filtersOpen || riskFilter.size > 0 || minComplexityNum != null
                ? "border-[#7C3AED]/40 text-[#7C3AED]"
                : "border-ink/12 text-sub hover:text-ink"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>

        {filtersOpen && (
          <div className="space-y-2 rounded-lg border border-ink/10 bg-surface/40 p-2.5">
            <div className="flex flex-wrap gap-1.5">
              {RISK_LEVELS.map((level) => {
                const active = riskFilter.has(level);
                const color = RISK_META[level].color;
                return (
                  <button
                    key={level}
                    onClick={() => toggleRisk(level)}
                    className="rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors"
                    style={{
                      borderColor: active ? color : "rgba(107,114,128,0.25)",
                      color: active ? color : "#6B7280",
                      background: active ? `${color}1f` : "transparent",
                    }}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-sub">Min complexity</label>
              <input
                type="number"
                min={0}
                value={minComplexity}
                onChange={(e) => setMinComplexity(e.target.value)}
                placeholder="e.g. 10"
                className="w-20 rounded-md border border-ink/12 bg-base px-2 py-1 text-[11px] text-ink outline-none placeholder:text-sub/50 focus:border-[#7C3AED]"
              />
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => {
                  setSearch("");
                  setRiskFilter(new Set());
                  setMinComplexity("");
                }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-sub hover:text-ink"
              >
                <X className="h-3 w-3" />
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {folders.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-sub">
            No chunks match these filters.
          </div>
        ) : (
          folders.map(({ filename, all, filtered }) => {
            const isCollapsed = collapsed.has(filename);
            const folderApproved = all.filter((c) => c.status === "Approved").length;
            const risk = worstRisk(all);
            return (
              <div key={filename} className="mb-1">
                <button
                  onClick={() => toggleFolder(filename)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink/[0.05]"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sub" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sub" />
                  )}
                  {isCollapsed ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-sub" />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#7C3AED]" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-ink/85">
                    {filename}
                  </span>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: RISK_META[risk].color }}
                  />
                  <span className="shrink-0 font-mono text-[10px] text-sub">
                    {hasActiveFilters
                      ? `${filtered.length}/${all.length}`
                      : `${folderApproved}/${all.length}`}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="ml-3 border-l border-ink/10 pl-1.5">
                    {filtered.map((chunk) => {
                      const active = chunk.id === selectedId;
                      return (
                        <button
                          key={chunk.id}
                          onClick={() => onSelect(chunk.id)}
                          className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                            active ? "bg-[#7C3AED]/[0.12]" : "hover:bg-ink/[0.05]"
                          }`}
                        >
                          {active && (
                            <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[#7C3AED]" />
                          )}
                          {chunk.id === busyId ? (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#7C3AED]/15 text-[#7C3AED]">
                              <Loader2 className="h-3 w-3 animate-spin" />
                            </span>
                          ) : (
                            <StatusDot status={chunk.status} />
                          )}
                          <div className="min-w-0 flex-1">
                            <div
                              className={`truncate font-mono text-[13px] ${
                                active ? "text-ink" : "text-ink/80"
                              }`}
                            >
                              {chunk.name}
                            </div>
                            <div className="text-[11px] text-sub">
                              {STATUS_META[chunk.status].label}
                              {chunk.static_analysis && (
                                <span className="ml-1.5 font-mono text-sub/70">
                                  · cx {chunk.static_analysis.complexity_score}
                                </span>
                              )}
                            </div>
                          </div>
                          <RiskBadge level={chunk.risk_level} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
