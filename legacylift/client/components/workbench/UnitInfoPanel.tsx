"use client";
// UnitInfoPanel - the review workbench's right-hand "what am I looking at"
// panel for the selected unit. One place that answers, in plain language:
// what this unit does (business rule + AI explain), what it depends on, what
// depends on it, and whether a change elsewhere affects it (impact notes).
// Written to read well for a non-technical reviewer while keeping the
// technical depth one tab away.

import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { BusinessRule, MigrationChunk } from "@/types/legacylift";
import type { FileSummary } from "@/lib/migration";
import { RiskBadge, StatusDot, STATUS_META } from "@/components/workbench/shared";

interface UnitInfoPanelProps {
  chunk: MigrationChunk;
  rule: BusinessRule | null;
  /** Units this one calls (its prerequisites). */
  dependencies: MigrationChunk[];
  /** Units that call this one (its blast radius when it changes). */
  dependents: MigrationChunk[];
  /** Cross-chunk impact notes for this unit (API changes upstream, etc.). */
  impactNotes: string[];
  /** True when an upstream API change broke references in this unit. */
  needsSync: boolean;
  explain: FileSummary | null;
  explaining: boolean;
  explainError: string | null;
  onExplain: () => void;
  onJump: (id: string) => void;
}

/** Plain-language status for non-technical reviewers. */
const PLAIN_STATUS: Record<MigrationChunk["status"], string> = {
  Pending: "Not migrated yet",
  Running: "Being migrated now…",
  Review: "Waiting for your review",
  Approved: "Approved",
  Rejected: "Sent back for changes",
};

function UnitLink({
  unit,
  onJump,
}: {
  unit: MigrationChunk;
  onJump: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onJump(unit.id)}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ink/[0.05]"
    >
      <StatusDot status={unit.status} />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink/80 group-hover:text-ink">
        {unit.name}
      </span>
      <span className="shrink-0 truncate font-mono text-[10px] text-sub/70">
        {unit.source_file}
      </span>
    </button>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-ink/10 px-3 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sub">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

export function UnitInfoPanel({
  chunk,
  rule,
  dependencies,
  dependents,
  impactNotes,
  needsSync,
  explain,
  explaining,
  explainError,
  onExplain,
  onJump,
}: UnitInfoPanelProps) {
  const [explainTab, setExplainTab] = useState<"layman" | "technical">("layman");

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Identity */}
      <div className="border-b border-ink/10 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-mono text-[13px] font-semibold text-ink">
            {chunk.name}
          </span>
          <RiskBadge level={chunk.risk_level} />
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-sub">
          {chunk.source_file} · lines {chunk.start_line}–{chunk.end_line}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-ink/80">
          <StatusDot status={chunk.status} />
          {PLAIN_STATUS[chunk.status] ?? STATUS_META[chunk.status]?.label ?? chunk.status}
        </div>
      </div>

      {/* Impact — surfaced first when something upstream changed */}
      {impactNotes.length > 0 && (
        <Section
          icon={
            needsSync ? (
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            ) : (
              <Info className="h-3 w-3" />
            )
          }
          title={needsSync ? "Needs sync" : "Recent changes nearby"}
        >
          <ul className="space-y-1.5">
            {impactNotes.map((note, i) => (
              <li
                key={i}
                className={`rounded-md border px-2 py-1.5 text-[11px] leading-relaxed ${
                  needsSync
                    ? "border-amber-500/30 bg-amber-500/[0.08] text-ink/85"
                    : "border-ink/10 bg-surface/40 text-sub"
                }`}
              >
                {note}
              </li>
            ))}
          </ul>
          {needsSync && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-sub">
              <RefreshCw className="h-3 w-3" />
              Regenerate this unit (or run the migration) to bring it back in sync.
            </p>
          )}
        </Section>
      )}

      {/* Business rule */}
      <Section icon={<BookOpen className="h-3 w-3" />} title="Business rule">
        {rule ? (
          <div>
            <div className="text-xs font-medium text-ink/90">{rule.title}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-sub">{rule.description}</p>
            {rule.hardcoded_values.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {rule.hardcoded_values.slice(0, 8).map((v) => (
                  <span
                    key={v}
                    className="rounded bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-ink/70"
                  >
                    {v}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-sub">No rule was extracted for this unit.</p>
        )}
      </Section>

      {/* AI explain */}
      <Section icon={<Sparkles className="h-3 w-3" />} title="Explain this unit">
        {explain ? (
          <div>
            <div className="mb-2 flex gap-1">
              {(["layman", "technical"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setExplainTab(tab)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    explainTab === tab
                      ? "border-[#7C3AED]/40 bg-[#7C3AED]/10 text-[#7C3AED]"
                      : "border-ink/12 text-sub hover:text-ink"
                  }`}
                >
                  {tab === "layman" ? "Plain English" : "Technical"}
                </button>
              ))}
            </div>
            <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink/80">
              {explainTab === "layman" ? explain.layman : explain.technical}
            </div>
          </div>
        ) : (
          <div>
            <button
              onClick={onExplain}
              disabled={explaining}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 py-1.5 text-[11px] font-medium text-ink/80 transition-colors hover:border-[#7C3AED]/40 hover:text-[#7C3AED] disabled:opacity-60"
            >
              {explaining ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Explaining…
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  Explain what this does
                </>
              )}
            </button>
            {explainError && (
              <p className="mt-1.5 text-[11px] text-red-400">{explainError}</p>
            )}
          </div>
        )}
      </Section>

      {/* Dependencies */}
      <Section icon={<ArrowDownRight className="h-3 w-3" />} title={`Depends on (${dependencies.length})`}>
        {dependencies.length > 0 ? (
          <div className="-mx-2">
            {dependencies.map((d) => (
              <UnitLink key={d.id} unit={d} onJump={onJump} />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-sub">
            Nothing — this unit stands alone, a safe place to start.
          </p>
        )}
      </Section>

      {/* Dependents */}
      <Section icon={<ArrowUpRight className="h-3 w-3" />} title={`Used by (${dependents.length})`}>
        {dependents.length > 0 ? (
          <div className="-mx-2">
            {dependents.map((d) => (
              <UnitLink key={d.id} unit={d} onJump={onJump} />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-sub">No other unit calls this one.</p>
        )}
        {dependents.length > 0 && (
          <p className="mt-1.5 text-[10px] leading-relaxed text-sub/80">
            Changing this unit's interface affects the unit{dependents.length === 1 ? "" : "s"} above —
            LegacyLift re-checks them automatically when this one changes.
          </p>
        )}
      </Section>
    </div>
  );
}
