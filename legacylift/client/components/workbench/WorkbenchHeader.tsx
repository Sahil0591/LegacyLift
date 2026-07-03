"use client";
// WorkbenchHeader — app-style top bar for the review workbench. Repo identity,
// an Overview/Review switch, and live migration progress.

import Link from "next/link";
import {
  Cpu,
  LayoutDashboard,
  GitPullRequestArrow,
  Download,
  Loader2,
  ArrowUpRight,
  Lightbulb,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

export type WorkbenchView = "overview" | "review";

export interface ActiveJob {
  chunkName: string;
  statusText: string;
  attempt: number;
  maxAttempts: number;
}

interface WorkbenchHeaderProps {
  repo: string;
  view: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
  /** Legacy source language, e.g. "COBOL". */
  sourceLang?: string;
  /** Distinct target-language labels across the project. */
  targetLabels?: string[];
  approved: number;
  total: number;
  onDownload?: () => void;
  canDownload?: boolean;
  /** Remaining/max daily AI-call quota — every migrate/review/tests call shares it. */
  quotaRemaining?: number | null;
  quotaMax?: number | null;
  /** A chunk generating/testing in the background while the user is elsewhere. */
  activeJob?: ActiveJob | null;
  onJumpToJob?: () => void;
  /** Launch the guided walkthrough (the lightbulb button). */
  onStartTour?: () => void;
}

const TABS: { id: WorkbenchView; label: string; Icon: typeof Cpu }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "review", label: "Review", Icon: GitPullRequestArrow },
];

export function WorkbenchHeader({
  repo,
  view,
  onViewChange,
  sourceLang = "COBOL",
  targetLabels = ["Python"],
  approved,
  total,
  onDownload,
  canDownload = false,
  quotaRemaining = null,
  quotaMax = null,
  activeJob = null,
  onJumpToJob,
  onStartTour,
}: WorkbenchHeaderProps) {
  const targets = targetLabels.length > 0 ? targetLabels : ["Python"];
  const targetText =
    targets.length === 1 ? targets[0] : `${targets.length} targets`;
  const quotaRatio =
    quotaRemaining != null && quotaMax ? quotaRemaining / quotaMax : null;
  const quotaColor =
    quotaRatio == null
      ? "#6B7280"
      : quotaRatio <= 0.05
        ? "#DC2626"
        : quotaRatio <= 0.2
          ? "#F59E0B"
          : "#6B7280";

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-ink/10 bg-base/80 px-4 backdrop-blur-xl">
      <Link
        href="/"
        className="flex items-center gap-2 text-ink transition-opacity hover:opacity-75"
      >
        <Cpu className="h-5 w-5 text-[#7C3AED]" />
        <span className="hidden font-semibold tracking-tight sm:inline">
          LegacyLift
        </span>
      </Link>

      <span className="h-5 w-px bg-ink/10" />

      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-sm text-ink/80">{repo}</span>
        <span
          title={
            targets.length > 1
              ? `${sourceLang} → ${targets.join(", ")}`
              : `${sourceLang} → ${targets[0]}`
          }
          className="hidden shrink-0 rounded-full border border-ink/10 px-2 py-0.5 text-[10px] font-medium text-sub md:inline"
        >
          {sourceLang} → {targetText}
        </span>
      </div>

      {/* View switch */}
      <div className="ml-auto flex items-center rounded-lg border border-ink/10 bg-surface/40 p-0.5">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            data-tour={`tab-${id}`}
            onClick={() => onViewChange(id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              view === id
                ? "bg-[#7C3AED] text-white"
                : "text-sub hover:text-ink"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      <div data-tour="progress" className="hidden items-center gap-2 lg:flex">
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-[#10B981] transition-all duration-500"
            style={{ width: `${total ? (approved / total) * 100 : 0}%` }}
          />
        </div>
        <span className="font-mono text-xs text-sub">
          {approved}/{total}
        </span>
      </div>

      {activeJob && (
        <button
          onClick={onJumpToJob}
          title="Jump back to this chunk"
          className="hidden shrink-0 items-center gap-2 rounded-lg border border-[#7C3AED]/25 bg-[#7C3AED]/[0.08] px-2.5 py-1.5 text-left transition-colors hover:bg-[#7C3AED]/[0.14] md:flex"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#7C3AED]" />
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1 truncate font-mono text-[11px] font-medium text-ink/85">
              {activeJob.chunkName}
              <ArrowUpRight className="h-3 w-3 shrink-0 text-[#7C3AED]" />
            </div>
            <div className="truncate text-[10px] text-sub">{activeJob.statusText}</div>
          </div>
          <div className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full rounded-full bg-[#7C3AED] transition-all duration-300"
              style={{
                width: `${Math.min(100, (activeJob.attempt / Math.max(1, activeJob.maxAttempts)) * 100)}%`,
              }}
            />
          </div>
        </button>
      )}

      {quotaRemaining != null && (
        <span
          className="hidden shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium md:inline"
          style={{ borderColor: `${quotaColor}40`, color: quotaColor }}
          title="Daily AI-call budget remaining — every generate/review/test call shares it"
        >
          {quotaRemaining}/{quotaMax} AI calls left
        </span>
      )}

      {onDownload && (
        <button
          onClick={onDownload}
          disabled={!canDownload}
          title={
            canDownload
              ? "Download migrated code"
              : "Generate at least one unit first"
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/12 px-3 py-1.5 text-sm font-medium text-ink/80 transition-colors hover:bg-ink/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Download</span>
        </button>
      )}

      {onStartTour && (
        <button
          data-tour="help"
          onClick={onStartTour}
          aria-label="Take a guided tour"
          title="Take a guided tour"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink/10 text-ink/70 transition-colors hover:bg-[#7C3AED]/10 hover:text-[#7C3AED]"
        >
          <Lightbulb className="h-4 w-4" />
        </button>
      )}

      <ThemeToggle />
      <UserButton />
    </header>
  );
}
