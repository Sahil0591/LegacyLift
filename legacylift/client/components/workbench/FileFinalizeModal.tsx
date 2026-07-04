"use client";
// FileFinalizeModal - the per-file "finish line": shows the assembled target
// file next to the original source, lets the reviewer run one last AI
// consistency check across every chunk in the file, and gates a "Finalize
// file" action behind it. Mirrors the visual language of ChunkReview's Checks.

import { useState } from "react";
import {
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  AlertOctagon,
  CornerDownRight,
  CheckCircle2,
} from "lucide-react";
import type { AIReviewResult } from "@/types/legacylift";
import type { FileGroup } from "@/hooks/useFileStatus";
import { assembleFile, concatenateSource } from "@/lib/fileAssembly";
import { reviewMigration } from "@/lib/migration";
import { toProfileCtx } from "@/lib/targetLanguages";
import { makeLesson, type Lesson } from "@/lib/lessons";

interface FileFinalizeModalProps {
  open: boolean;
  onClose: () => void;
  file: FileGroup;
  onFinalize: () => void;
  /** Called once per finding when the on-demand check completes. */
  onLessonLearned?: (lesson: Lesson) => void;
}

export function FileFinalizeModal({
  open,
  onClose,
  file,
  onFinalize,
  onLessonLearned,
}: FileFinalizeModalProps) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [review, setReview] = useState<AIReviewResult | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [confirmCritical, setConfirmCritical] = useState(false);

  if (!open) return null;

  const assembled = assembleFile(file.filename, file.chunks, file.target);
  const source = concatenateSource(file.chunks);
  const allChunksHaveCode = file.chunks.every(
    (c) => c.migrated_code.trim().length > 0,
  );
  const criticalIssues = review?.critical_issues ?? [];
  const canFinalize = allChunksHaveCode && hasChecked;
  const finalizeBlockedReason = !allChunksHaveCode
    ? "Some chunks in this file have no migrated code yet"
    : !hasChecked
      ? "Run the final check before finalizing"
      : undefined;

  const requestFinalize = () => {
    if (criticalIssues.length > 0) setConfirmCritical(true);
    else onFinalize();
  };

  const runCheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const result = await reviewMigration({
        name: file.filename,
        sourceCode: source,
        migratedCode: assembled,
        targetLang: file.target.language,
        targetProfile: toProfileCtx(file.target),
      });
      setReview(result);
      for (const text of [...result.critical_issues, ...result.warnings]) {
        onLessonLearned?.(
          makeLesson({ source: "file_check", sourceFile: file.filename, text }),
        );
      }
    } catch (err) {
      setCheckError(
        err instanceof Error
          ? err.message
          : "File too large for a single consistency pass - per-chunk reviews already ran.",
      );
    } finally {
      setChecking(false);
      setHasChecked(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-ink/10 bg-base shadow-2xl">
        <div className="flex items-center gap-3 border-b border-ink/10 px-6 py-4">
          <h2 className="font-mono text-base font-semibold text-ink">
            {file.filename}
          </h2>
          <span className="font-mono text-xs text-sub">
            {file.approvedCount}/{file.totalCount} units approved
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-sub transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
              <div className="border-b border-ink/10 px-4 py-2 text-xs font-semibold text-ink/80">
                Legacy source (concatenated)
              </div>
              <pre className="max-h-64 overflow-auto p-3 font-mono text-[12px] leading-[1.7] text-ink/90">
                {source}
              </pre>
            </div>
            <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
              <div className="border-b border-ink/10 px-4 py-2 text-xs font-semibold text-ink/80">
                Assembled target file
              </div>
              <pre className="max-h-64 overflow-auto p-3 font-mono text-[12px] leading-[1.7] text-ink/90">
                {assembled}
              </pre>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-sub">
                Final consistency check
              </span>
              {!hasChecked && (
                <button
                  onClick={runCheck}
                  disabled={checking}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/30 px-3 py-1.5 text-xs font-semibold text-[#7C3AED] transition-colors hover:bg-[#7C3AED]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {checking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {checking ? "Checking…" : "Run final check"}
                </button>
              )}
            </div>
            <div className="px-4 py-3">
              {checkError && (
                <div className="flex items-start gap-2 text-xs text-[#F59E0B]">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {checkError}
                </div>
              )}
              {review && (
                <div className="space-y-2 text-xs">
                  <div className="text-ink/80">
                    {review.issues_found === 0
                      ? "No cross-chunk consistency issues found."
                      : `${review.issues_found} note${review.issues_found > 1 ? "s" : ""} · ${review.ai_confidence} confidence`}
                  </div>
                  {review.critical_issues.map((c) => (
                    <div key={c} className="flex items-start gap-2 text-[#DC2626]">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {c}
                    </div>
                  ))}
                  {review.warnings.map((w) => (
                    <div key={w} className="flex items-start gap-2 text-ink/70">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#F59E0B]" />
                      {w}
                    </div>
                  ))}
                  {review.suggestions.map((s) => (
                    <div key={s} className="flex items-start gap-2 text-sub">
                      <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0" />
                      {s}
                    </div>
                  ))}
                </div>
              )}
              {!review && !checkError && !checking && !hasChecked && (
                <div className="text-xs text-sub">
                  Optional - reviews every chunk in this file together for
                  naming/consistency issues a per-chunk review can't catch.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-ink/10 bg-surface/40 px-6 py-4">
          <p className="mr-auto text-sm text-sub">
            Finalizing locks this file in for download.
          </p>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-sub transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={requestFinalize}
            disabled={!canFinalize}
            title={finalizeBlockedReason}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCircle2 className="h-4 w-4" />
            Finalize file
          </button>
        </div>
      </div>

      {confirmCritical && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="w-full max-w-md rounded-xl border border-ink/10 bg-base p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#DC2626]">
              <AlertOctagon className="h-4 w-4" />
              {criticalIssues.length} critical issue{criticalIssues.length === 1 ? "" : "s"} found
            </div>
            <p className="mt-2 text-sm text-ink/80">
              The final consistency check flagged critical issues in{" "}
              {file.filename}. Are you sure you want to finalize it anyway?
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
                  onFinalize();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#B91C1C]"
              >
                Finalize anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
