"use client";
// Shared workbench primitives - risk + status helpers and small badges.
// Everything uses the app's theme tokens so the workbench stays cohesive.

import { Check, Circle, Loader2, X, Eye } from "lucide-react";
import type { ChunkStatus, RiskLevel } from "@/types/legacylift";

export const RISK_META: Record<RiskLevel, { color: string; label: string }> = {
  Low: { color: "#10B981", label: "Low" },
  Medium: { color: "#F59E0B", label: "Medium" },
  High: { color: "#F97316", label: "High" },
  Critical: { color: "#DC2626", label: "Critical" },
};

export function scoreToLevel(score: number): RiskLevel {
  if (score >= 0.8) return "Critical";
  if (score >= 0.6) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}

// Higher = more attention needed. Used to sort the migration queue.
export const RISK_RANK: Record<RiskLevel, number> = {
  Critical: 3,
  High: 2,
  Medium: 1,
  Low: 0,
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  const r = RISK_META[level];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${r.color}1f`, color: r.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
      {r.label}
    </span>
  );
}

export const STATUS_META: Record<
  ChunkStatus,
  { label: string; color: string; Icon: typeof Check }
> = {
  Approved: { label: "Merged", color: "#10B981", Icon: Check },
  Review: { label: "In review", color: "#7C3AED", Icon: Eye },
  Running: { label: "Analyzing", color: "#F59E0B", Icon: Loader2 },
  Pending: { label: "Queued", color: "#6B7280", Icon: Circle },
  Rejected: { label: "Rejected", color: "#DC2626", Icon: X },
};

export function StatusDot({ status }: { status: ChunkStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{ background: `${m.color}26`, color: m.color }}
    >
      <m.Icon
        className={`h-3 w-3 ${status === "Running" ? "animate-spin" : ""}`}
      />
    </span>
  );
}
