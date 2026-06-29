"use client";
// ChunkReview — the focused review of one migration unit: before/after code,
// the checks that ran, and a clear approve / reject decision (like a PR review).

import { useState } from "react";
import {
  Check,
  X,
  ShieldCheck,
  Sparkles,
  FlaskConical,
  AlertTriangle,
  CornerDownRight,
} from "lucide-react";
import type { MigrationChunk } from "@/types/legacylift";
import { CodeCompare } from "@/components/workbench/CodeCompare";
import { RiskBadge, STATUS_META } from "@/components/workbench/shared";

interface ChunkReviewProps {
  chunk: MigrationChunk;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}

function CheckRow({
  Icon,
  label,
  detail,
  tone,
}: {
  Icon: typeof Check;
  label: string;
  detail: string;
  tone: "pass" | "warn" | "idle";
}) {
  const color =
    tone === "pass" ? "#10B981" : tone === "warn" ? "#F59E0B" : "#6B7280";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}1f`, color }}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="text-sm font-medium text-ink/90">{label}</span>
      <span className="ml-auto font-mono text-xs text-sub">{detail}</span>
    </div>
  );
}

function Checks({ chunk }: { chunk: MigrationChunk }) {
  const tests = chunk.test_results;
  const passed = tests.filter((t) => t.passed).length;
  const ai = chunk.ai_review;

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
      <div className="border-b border-ink/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-sub">
        Checks
      </div>
      <div className="divide-y divide-ink/[0.06]">
        <CheckRow
          Icon={ShieldCheck}
          label="Static analysis"
          tone={chunk.static_analysis?.passed ? "pass" : "idle"}
          detail={
            chunk.static_analysis
              ? `passed · complexity ${chunk.static_analysis.complexity_score}`
              : "not run"
          }
        />
        <CheckRow
          Icon={Sparkles}
          label="AI semantic review"
          tone={ai ? (ai.issues_found > 0 ? "warn" : "pass") : "idle"}
          detail={
            ai
              ? ai.issues_found === 0
                ? "no issues"
                : `${ai.issues_found} note${ai.issues_found > 1 ? "s" : ""} · ${ai.ai_confidence} confidence`
              : "not run"
          }
        />
        <CheckRow
          Icon={FlaskConical}
          label="Generated tests"
          tone={
            tests.length === 0
              ? "idle"
              : passed === tests.length
                ? "pass"
                : "warn"
          }
          detail={
            tests.length ? `${passed}/${tests.length} passing` : "not run"
          }
        />

        {ai && (ai.warnings.length > 0 || ai.suggestions.length > 0) && (
          <div className="space-y-1.5 bg-ink/[0.02] px-4 py-3">
            {ai.warnings.map((w) => (
              <div
                key={w}
                className="flex items-start gap-2 text-xs text-ink/70"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#F59E0B]" />
                {w}
              </div>
            ))}
            {ai.suggestions.map((s) => (
              <div
                key={s}
                className="flex items-start gap-2 text-xs text-sub"
              >
                <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChunkReview({ chunk, onApprove, onReject }: ChunkReviewProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const inReview = chunk.status === "Review";
  const statusMeta = STATUS_META[chunk.status];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ink/10 px-6 py-4">
        <h1 className="font-mono text-lg font-semibold text-ink">
          {chunk.name}
        </h1>
        <RiskBadge level={chunk.risk_level} />
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{
            background: `${statusMeta.color}1f`,
            color: statusMeta.color,
          }}
        >
          {statusMeta.label}
        </span>
        <span className="ml-auto font-mono text-xs text-sub">{chunk.id}</span>
      </div>

      {/* Scroll body */}
      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        <CodeCompare source={chunk.source_code} migrated={chunk.migrated_code} />
        <Checks chunk={chunk} />
      </div>

      {/* Decision bar */}
      <div className="border-t border-ink/10 bg-surface/40 px-6 py-4">
        {!inReview ? (
          <div className="flex items-center justify-center gap-2 text-sm text-sub">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: statusMeta.color }}
            />
            This chunk is {statusMeta.label.toLowerCase()}.
          </div>
        ) : rejecting ? (
          <div className="space-y-3">
            <label className="text-xs font-medium text-sub">
              What needs to change? (required)
            </label>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. rounding mode doesn't match the legacy ROUNDED behaviour…"
              className="w-full resize-none rounded-lg border border-ink/15 bg-base px-3 py-2 text-sm text-ink outline-none placeholder:text-sub/50 focus:border-[#DC2626]"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-sub transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                disabled={reason.trim().length < 8}
                onClick={() => onReject(chunk.id, reason)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-4 w-4" />
                Request changes
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="mr-auto text-sm text-sub">
              You're the final gate — nothing merges until you approve.
            </p>
            <button
              onClick={() => setRejecting(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-4 py-2.5 text-sm font-semibold text-ink/80 transition-colors hover:border-[#DC2626]/50 hover:text-[#DC2626]"
            >
              <X className="h-4 w-4" />
              Request changes
            </button>
            <button
              onClick={() => onApprove(chunk.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-[#059669]"
            >
              <Check className="h-4 w-4" />
              Approve &amp; merge
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
