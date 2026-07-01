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
  AlertOctagon,
  CornerDownRight,
  Loader2,
  RotateCcw,
  Wrench,
} from "lucide-react";
import type { MigrationChunk } from "@/types/legacylift";
import { CodeCompare } from "@/components/workbench/CodeCompare";
import { RiskBadge, STATUS_META } from "@/components/workbench/shared";

interface ChunkReviewProps {
  chunk: MigrationChunk;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  /** Reopen an already-approved (or rejected) chunk for another look/edit. */
  onReopen?: (id: string) => void;
  /** Re-generate + re-review with Venice; optional reviewer guidance. */
  onRegenerate?: (instructions?: string) => void;
  /** One-click "Fix with AI" on a specific AI review finding — regenerates using it as guidance. */
  onFixWithAI?: (instructions: string) => void;
  /** Save a hand-edited version of the migrated code — bypasses the LLM entirely. */
  onManualEdit?: (code: string) => void;
  /** Re-run static analysis/AI review/tests on the current code without regenerating it. */
  onRunChecks?: () => void;
  regenerating?: boolean;
  regenError?: string | null;
  /** Live status while an auto-fix loop is running, e.g. "Fixing issues (attempt 2/8)…". */
  regenStatus?: string | null;
  /** Regenerations left for this chunk (limit). */
  regenRemaining?: number;
  regenerateLabel?: string;
}

function CheckRow({
  Icon,
  label,
  detail,
  tone,
  loading = false,
}: {
  Icon: typeof Check;
  label: string;
  detail: string;
  tone: "pass" | "warn" | "idle";
  loading?: boolean;
}) {
  const color = loading
    ? "#7C3AED"
    : tone === "pass"
      ? "#10B981"
      : tone === "warn"
        ? "#F59E0B"
        : "#6B7280";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}1f`, color }}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="text-sm font-medium text-ink/90">{label}</span>
      <span
        className={`ml-auto font-mono text-xs ${loading ? "animate-pulse text-[#7C3AED]" : "text-sub"}`}
      >
        {detail}
      </span>
    </div>
  );
}

function FixWithAIButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Fix with AI — regenerate this chunk using this finding as guidance"
      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-[#7C3AED]/30 px-1.5 py-0.5 text-[10px] font-semibold text-[#7C3AED] transition-colors hover:bg-[#7C3AED]/10"
    >
      <Wrench className="h-2.5 w-2.5" />
      Fix with AI
    </button>
  );
}

function Checks({
  chunk,
  regenerating,
  onFixIssue,
}: {
  chunk: MigrationChunk;
  regenerating: boolean;
  onFixIssue?: (text: string) => void;
}) {
  const tests = chunk.test_results;
  const passed = tests.filter((t) => t.passed).length;
  const ai = chunk.ai_review;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (text: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });
  const fixSelected = () => {
    if (!onFixIssue || selected.size === 0) return;
    onFixIssue([...selected].map((t) => `- ${t}`).join("\n"));
    setSelected(new Set());
  };

  // A check is loading when Venice is working AND the result hasn't arrived yet.
  const codeReady = chunk.migrated_code.trim().length > 0;
  const staticLoading = regenerating && !chunk.static_analysis;
  const aiLoading = regenerating && !ai && codeReady;
  const testsLoading = regenerating && tests.length === 0 && codeReady;

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-sub">
          Checks
        </span>
        {regenerating && (
          <span className="flex items-center gap-1.5 text-[11px] text-[#7C3AED]">
            <Loader2 className="h-3 w-3 animate-spin" />
            running checks…
          </span>
        )}
      </div>
      <div className="divide-y divide-ink/[0.06]">
        <CheckRow
          Icon={ShieldCheck}
          label="Static analysis"
          tone={chunk.static_analysis?.passed ? "pass" : "idle"}
          loading={staticLoading}
          detail={
            staticLoading
              ? "analysing…"
              : chunk.static_analysis
                ? `passed · complexity ${chunk.static_analysis.complexity_score}`
                : "not run"
          }
        />
        <CheckRow
          Icon={Sparkles}
          label="AI semantic review"
          tone={ai ? (ai.issues_found > 0 ? "warn" : "pass") : "idle"}
          loading={aiLoading}
          detail={
            aiLoading
              ? "reviewing with AI…"
              : ai
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
          loading={testsLoading}
          detail={
            testsLoading
              ? "generating & running tests…"
              : tests.length
                ? `${passed}/${tests.length} passing`
                : "not run"
          }
        />

        {ai &&
          (ai.critical_issues.length > 0 ||
            ai.warnings.length > 0 ||
            ai.suggestions.length > 0) && (
            <div className="space-y-1.5 bg-ink/[0.02] px-4 py-3">
              {onFixIssue && selected.size > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-[#7C3AED]/10 px-2.5 py-1.5">
                  <span className="text-[11px] font-medium text-[#7C3AED]">
                    {selected.size} selected
                  </span>
                  <button
                    onClick={fixSelected}
                    className="inline-flex items-center gap-1 rounded-full bg-[#7C3AED] px-2 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-[#6D28D9]"
                  >
                    <Wrench className="h-2.5 w-2.5" />
                    Fix {selected.size} with AI
                  </button>
                </div>
              )}
              {ai.critical_issues.map((c) => (
                <div
                  key={c}
                  className="flex items-start gap-2 text-xs text-[#DC2626]"
                >
                  {onFixIssue && (
                    <input
                      type="checkbox"
                      checked={selected.has(c)}
                      onChange={() => toggle(c)}
                      className="mt-0.5 h-3 w-3 shrink-0 accent-[#7C3AED]"
                    />
                  )}
                  <AlertOctagon className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="flex-1">{c}</span>
                  {onFixIssue && <FixWithAIButton onClick={() => onFixIssue(c)} />}
                </div>
              ))}
              {ai.warnings.map((w) => (
                <div
                  key={w}
                  className="flex items-start gap-2 text-xs text-ink/70"
                >
                  {onFixIssue && (
                    <input
                      type="checkbox"
                      checked={selected.has(w)}
                      onChange={() => toggle(w)}
                      className="mt-0.5 h-3 w-3 shrink-0 accent-[#7C3AED]"
                    />
                  )}
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#F59E0B]" />
                  <span className="flex-1">{w}</span>
                  {onFixIssue && <FixWithAIButton onClick={() => onFixIssue(w)} />}
                </div>
              ))}
              {ai.suggestions.map((s) => (
                <div
                  key={s}
                  className="flex items-start gap-2 text-xs text-sub"
                >
                  {onFixIssue && (
                    <input
                      type="checkbox"
                      checked={selected.has(s)}
                      onChange={() => toggle(s)}
                      className="mt-0.5 h-3 w-3 shrink-0 accent-[#7C3AED]"
                    />
                  )}
                  <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="flex-1">{s}</span>
                  {onFixIssue && <FixWithAIButton onClick={() => onFixIssue(s)} />}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

export function ChunkReview({
  chunk,
  onApprove,
  onReject,
  onReopen,
  onRegenerate,
  onFixWithAI,
  onManualEdit,
  onRunChecks,
  regenerating = false,
  regenError = null,
  regenStatus = null,
  regenRemaining = Infinity,
  regenerateLabel = "Regenerate with Venice",
}: ChunkReviewProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmCritical, setConfirmCritical] = useState(false);
  const inReview = chunk.status === "Review";
  const statusMeta = STATUS_META[chunk.status];
  const canRegen = regenRemaining > 0;

  const codeReady = chunk.migrated_code.trim().length > 0;
  const checksComplete = !!chunk.static_analysis && !!chunk.ai_review;
  const canApprove = codeReady && checksComplete && !regenerating;
  const criticalIssues = chunk.ai_review?.critical_issues ?? [];
  const approveBlockedReason = !codeReady
    ? "No migrated code yet — generate before merging"
    : !checksComplete
      ? "Waiting for checks to finish"
      : regenerating
        ? "Regeneration in progress"
        : undefined;

  const requestApprove = () => {
    if (criticalIssues.length > 0) setConfirmCritical(true);
    else onApprove(chunk.id);
  };

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
        <div className="ml-auto flex items-center gap-3">
          {onRunChecks && (
            <button
              onClick={onRunChecks}
              disabled={regenerating || !codeReady}
              title={
                codeReady
                  ? "Re-run static analysis, AI review, and tests on the current code — no regeneration"
                  : "No migrated code to check yet"
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 transition-colors hover:border-[#7C3AED]/50 hover:text-[#7C3AED] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Run checks
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={() => onRegenerate()}
              disabled={regenerating || !canRegen}
              title={canRegen ? undefined : "Regeneration limit reached"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/30 px-3 py-1.5 text-xs font-semibold text-[#7C3AED] transition-colors hover:bg-[#7C3AED]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {regenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {regenerating
                ? "Generating…"
                : !canRegen
                  ? "Limit reached"
                  : regenerateLabel}
            </button>
          )}
          <span className="font-mono text-xs text-sub">{chunk.id}</span>
        </div>
      </div>

      {regenError && (
        <div className="border-b border-[#DC2626]/30 bg-[#DC2626]/10 px-6 py-2.5 text-xs text-[#DC2626]">
          {regenError}
        </div>
      )}
      {!regenError && regenStatus && (
        <div className="flex items-center gap-2 border-b border-[#7C3AED]/30 bg-[#7C3AED]/10 px-6 py-2.5 text-xs font-medium text-[#7C3AED]">
          <Loader2 className="h-3 w-3 animate-spin" />
          {regenStatus}
        </div>
      )}

      {/* Scroll body */}
      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        <CodeCompare
          source={chunk.source_code}
          migrated={chunk.migrated_code}
          onSaveEdit={onManualEdit}
        />
        <Checks key={chunk.id} chunk={chunk} regenerating={regenerating} onFixIssue={onFixWithAI} />
      </div>

      {/* Decision bar */}
      <div className="border-t border-ink/10 bg-surface/40 px-6 py-4">
        {!inReview ? (
          <div className="flex items-center justify-center gap-3 text-sm text-sub">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: statusMeta.color }}
            />
            This chunk is {statusMeta.label.toLowerCase()}.
            {onReopen && (chunk.status === "Approved" || chunk.status === "Rejected") && (
              <button
                onClick={() => onReopen(chunk.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/80 transition-colors hover:border-[#7C3AED]/50 hover:text-[#7C3AED]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reopen for edits
              </button>
            )}
          </div>
        ) : rejecting ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-sub">
                What should change?
              </label>
              {Number.isFinite(regenRemaining) && (
                <span className="text-[11px] text-sub">
                  {regenRemaining} regeneration{regenRemaining === 1 ? "" : "s"}{" "}
                  left
                </span>
              )}
            </div>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. use banker's rounding; keep the WS-MAX-INT cap; rename vars to snake_case…"
              className="w-full resize-none rounded-lg border border-ink/15 bg-base px-3 py-2 text-sm text-ink outline-none placeholder:text-sub/50 focus:border-[#7C3AED]"
            />
            <div className="flex items-center justify-end gap-2">
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
                onClick={() => {
                  onReject(chunk.id, reason);
                  setRejecting(false);
                  setReason("");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#DC2626]/40 px-4 py-2 text-sm font-semibold text-[#DC2626] transition-colors hover:bg-[#DC2626]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-4 w-4" />
                Reject
              </button>
              {onRegenerate && (
                <button
                  disabled={reason.trim().length < 8 || regenerating || !canRegen}
                  onClick={() => {
                    onRegenerate(reason);
                    setRejecting(false);
                    setReason("");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Sparkles className="h-4 w-4" />
                  Regenerate with changes
                </button>
              )}
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
              onClick={requestApprove}
              disabled={!canApprove}
              title={approveBlockedReason}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
              Approve &amp; merge
            </button>
          </div>
        )}
      </div>

      {confirmCritical && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
          <div className="w-full max-w-md rounded-xl border border-ink/10 bg-base p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#DC2626]">
              <AlertOctagon className="h-4 w-4" />
              {criticalIssues.length} critical issue{criticalIssues.length === 1 ? "" : "s"} found
            </div>
            <p className="mt-2 text-sm text-ink/80">
              The AI review flagged critical issues on this chunk. Are you sure
              you want to approve and merge it anyway?
            </p>
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-ink/70">
              {criticalIssues.map((c) => (
                <li key={c} className="flex items-start gap-1.5">
                  <span className="shrink-0">•</span>
                  {c}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmCritical(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-sub transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmCritical(false);
                  onApprove(chunk.id);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#B91C1C]"
              >
                Approve anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
