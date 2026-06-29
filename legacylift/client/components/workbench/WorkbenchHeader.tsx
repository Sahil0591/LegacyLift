"use client";
// WorkbenchHeader — app-style top bar for the review workbench. Repo identity,
// an Overview/Review switch, and live migration progress.

import Link from "next/link";
import { Cpu, LayoutDashboard, GitPullRequestArrow } from "lucide-react";

export type WorkbenchView = "overview" | "review";

interface WorkbenchHeaderProps {
  repo: string;
  view: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
  approved: number;
  total: number;
}

const TABS: { id: WorkbenchView; label: string; Icon: typeof Cpu }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "review", label: "Review", Icon: GitPullRequestArrow },
];

export function WorkbenchHeader({
  repo,
  view,
  onViewChange,
  approved,
  total,
}: WorkbenchHeaderProps) {
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
        <span className="hidden shrink-0 rounded-full border border-ink/10 px-2 py-0.5 text-[10px] font-medium text-sub md:inline">
          COBOL → Python
        </span>
      </div>

      {/* View switch */}
      <div className="ml-auto flex items-center rounded-lg border border-ink/10 bg-surface/40 p-0.5">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
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

      <div className="hidden items-center gap-2 lg:flex">
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
    </header>
  );
}
