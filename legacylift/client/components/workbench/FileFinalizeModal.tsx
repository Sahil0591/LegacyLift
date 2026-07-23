"use client";
// FileFinalizeModal - the per-file "finish line": shows the final target file
// next to the original source for a mandatory last human review. The reviewer
// can run the AI reconcile pass (merge chunks into one coherent module), run an
// optional consistency check, and edit the file directly; "Finalize file" is
// gated behind an explicit "I've reviewed this" acknowledgement that any edit or
// re-reconcile resets. Mirrors the visual language of ChunkReview's Checks.

import { useState } from "react";
import {
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  AlertOctagon,
  CornerDownRight,
  CheckCircle2,
  Wand2,
  ShieldCheck,
} from "lucide-react";
import type { AIReviewResult } from "@/types/legacylift";
import type { FileGroup } from "@/hooks/useFileStatus";
import { assembleFile, concatenateSource } from "@/lib/fileAssembly";
import {
  finalizeFile,
  reviewMigration,
  validateFile,
  type FinalizeFileInput,
  type ValidationResult,
} from "@/lib/migration";
import { toProfileCtx } from "@/lib/targetLanguages";
import { makeLesson, type Lesson } from "@/lib/lessons";

// A whole-file reconcile must fit in one model response; above this the client
// keeps the deterministic assembly (still human-reviewed + validated) rather
// than risk a truncated file. ~48k chars ≈ 12k output tokens, under the
// server's 16k finalize cap.
const RECONCILE_MAX_CHARS = 48_000;

interface FileFinalizeModalProps {
  open: boolean;
  onClose: () => void;
  file: FileGroup;
  /** Receives the AI-reconciled module when the reviewer ran reconcile, so it
   *  becomes what gets stored + downloaded instead of the raw assembly. */
  onFinalize: (reconciledCode?: string) => void;
  /** Called once per finding when the on-demand check completes. */
  onLessonLearned?: (lesson: Lesson) => void;
  /** Authoritative context fed into the reconcile pass so the finalized file
   *  keeps the org's conventions, this file's rules, and cross-file naming. */
  institutionalContext?: string;
  projectManifest?: string;
  /** Already-migrated TARGET API of OTHER files, so cross-file references
   *  reconcile to real neighbour names/signatures (not just within-file drift). */
  generatedApi?: string;
  businessRules?: FinalizeFileInput["businessRules"];
}

export function FileFinalizeModal({
  open,
  onClose,
  file,
  onFinalize,
  onLessonLearned,
  institutionalContext,
  projectManifest,
  generatedApi,
  businessRules,
}: FileFinalizeModalProps) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [review, setReview] = useState<AIReviewResult | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<string | null>(null);
  // The reviewer's working copy of the final file (editable). null = follow the
  // computed default (reconciled output, else the deterministic assembly).
  const [draft, setDraft] = useState<string | null>(null);
  // The human must tick this after reading the final file. Any edit or a fresh
  // reconcile clears it, so a changed file can never be finalized unreviewed.
  const [reviewedAck, setReviewedAck] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);

  if (!open) return null;

  const assembled = assembleFile(file.filename, file.chunks, file.target);
  const source = concatenateSource(file.chunks);
  // The exact text that gets locked in and downloaded: the reviewer's edits if
  // any, else the AI-reconciled module, else the deterministic assembly.
  const finalCode = draft ?? reconciled ?? assembled;
  const allChunksHaveCode = file.chunks.every(
    (c) => c.migrated_code.trim().length > 0,
  );
  const criticalIssues = review?.critical_issues ?? [];
  const validationFailed = validation?.status === "failed";
  // Above this size a single-pass reconcile risks a truncated response; keep the
  // deterministic assembly instead (still reviewed + validated).
  const tooBigToReconcile = assembled.length > RECONCILE_MAX_CHARS;
  // Finalize is gated purely on the human having reviewed the actual final file.
  const canFinalize = allChunksHaveCode && reviewedAck;
  const finalizeBlockedReason = !allChunksHaveCode
    ? "Some chunks in this file have no migrated code yet"
    : !reviewedAck
      ? "Review the final file, then tick the confirmation to finalize"
      : undefined;

  // Hand up the reviewed text unless it is byte-identical to the plain assembly
  // (then undefined lets download derive it and we skip persisting a copy).
  const finalToLock = finalCode.trim() === assembled.trim() ? undefined : finalCode;

  const requestFinalize = () => {
    // Surface a confirmation when a check flagged something - either the AI
    // consistency review (critical issues) or the build/syntax validator.
    if (criticalIssues.length > 0 || validationFailed) setConfirmOverride(true);
    else onFinalize(finalToLock);
  };

  const runValidate = async (codeArg?: string) => {
    setValidating(true);
    setValidateError(null);
    try {
      const result = await validateFile({
        code: codeArg ?? finalCode,
        targetLang: file.target.language,
      });
      setValidation(result);
    } catch (err) {
      setValidateError(
        err instanceof Error ? err.message : "Could not run the build check.",
      );
    } finally {
      setValidating(false);
    }
  };

  const runReconcile = async () => {
    setReconciling(true);
    setReconcileError(null);
    try {
      const result = await finalizeFile({
        filename: file.filename,
        assembledCode: assembled,
        sourceCode: source,
        targetLang: file.target.language,
        targetProfile: toProfileCtx(file.target),
        institutionalContext,
        projectManifest,
        generatedApi,
        businessRules,
      });
      setReconciled(result.code);
      // Drop the reviewer into the reconciled output; a changed file must be
      // re-reviewed and re-validated before it can be finalized.
      setDraft(result.code);
      setReviewedAck(false);
      setValidation(null);
      void runValidate(result.code);
    } catch (err) {
      setReconcileError(
        err instanceof Error
          ? err.message
          : "Could not reconcile this file - you can still finalize the assembled version.",
      );
    } finally {
      setReconciling(false);
    }
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
              <pre className="h-72 overflow-auto p-3 font-mono text-[12px] leading-[1.7] text-ink/90">
                {source}
              </pre>
            </div>
            <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
              <div className="flex items-center gap-2 border-b border-ink/10 px-4 py-2">
                <span className="text-xs font-semibold text-ink/80">
                  Final file — review &amp; edit
                </span>
                {reconciled && draft === reconciled && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#10B981]/15 px-2 py-0.5 text-[10px] font-semibold text-[#10B981]">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    AI-reconciled
                  </span>
                )}
                {draft !== null && draft !== reconciled && (
                  <span className="rounded-full bg-ink/[0.08] px-2 py-0.5 text-[10px] font-semibold text-sub">
                    edited
                  </span>
                )}
                <button
                  onClick={runReconcile}
                  disabled={reconciling || !allChunksHaveCode || tooBigToReconcile}
                  title={
                    tooBigToReconcile
                      ? "This file is too large to reconcile in one pass - review and finalize the assembled version instead"
                      : "Merge every chunk into one coherent module: unify drifted names, resolve cross-chunk references, and de-duplicate shared code without changing behaviour"
                  }
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/30 px-2.5 py-1 text-[11px] font-semibold text-[#7C3AED] transition-colors hover:bg-[#7C3AED]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {reconciling ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  {reconciling
                    ? "Reconciling…"
                    : reconciled
                      ? "Re-reconcile"
                      : "Assemble & reconcile"}
                </button>
              </div>
              <textarea
                value={finalCode}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setReviewedAck(false);
                  setValidation(null);
                }}
                spellCheck={false}
                aria-label="Final file to review before finalizing"
                className="block h-72 w-full resize-none bg-transparent p-3 font-mono text-[12px] leading-[1.7] text-ink/90 outline-none"
              />
              {tooBigToReconcile && (
                <div className="flex items-start gap-2 border-t border-ink/10 px-4 py-2 text-[11px] text-sub">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Too large to AI-reconcile in one pass — imports are still
                  de-duplicated; review &amp; validate the assembled file below.
                </div>
              )}
              {reconcileError && (
                <div className="flex items-start gap-2 border-t border-ink/10 px-4 py-2 text-[11px] text-[#F59E0B]">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {reconcileError}
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
            <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-sub">
                Build / syntax check
              </span>
              <button
                onClick={() => runValidate()}
                disabled={validating || !allChunksHaveCode}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/30 px-3 py-1.5 text-xs font-semibold text-[#7C3AED] transition-colors hover:bg-[#7C3AED]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {validating ? "Validating…" : "Validate file"}
              </button>
            </div>
            <div className="space-y-1.5 px-4 py-3 text-xs">
              {validateError && (
                <div className="flex items-start gap-2 text-[#F59E0B]">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {validateError}
                </div>
              )}
              {validation?.status === "passed" && (
                <div className="flex items-start gap-2 text-[#10B981]">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                  Compiles / parses cleanly ({validation.validator}).
                </div>
              )}
              {validation?.status === "failed" && (
                <>
                  <div className="flex items-center gap-2 font-semibold text-[#DC2626]">
                    <AlertOctagon className="h-3.5 w-3.5" />
                    Build / syntax check failed ({validation.validator})
                  </div>
                  {validation.issues.map((issue) => (
                    <div key={issue} className="flex items-start gap-2 text-[#DC2626]">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      {issue}
                    </div>
                  ))}
                </>
              )}
              {validation?.status === "unavailable" && (
                <div className="flex items-start gap-2 text-sub">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Couldn&apos;t validate here — the {file.target.label} toolchain
                  isn&apos;t installed on the server. Build the file in your own
                  environment before shipping.
                </div>
              )}
              {validation?.warnings.map((w) => (
                <div key={w} className="flex items-start gap-2 text-ink/70">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#F59E0B]" />
                  {w}
                </div>
              ))}
              {!validation && !validateError && !validating && (
                <div className="text-sub">
                  Runs the {file.target.label} compiler/parser on the whole final
                  file to catch anything that won&apos;t build. No code is executed.
                </div>
              )}
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
          <label className="mr-auto flex items-center gap-2 text-sm text-ink/80">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#10B981]"
              checked={reviewedAck}
              disabled={!allChunksHaveCode}
              onChange={(e) => setReviewedAck(e.target.checked)}
            />
            I&apos;ve reviewed the final file and want to finalize it
          </label>
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

      {confirmOverride && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="w-full max-w-md rounded-xl border border-ink/10 bg-base p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#DC2626]">
              <AlertOctagon className="h-4 w-4" />
              {validationFailed ? "This file failed its checks" : "Unresolved issues"}
            </div>
            <p className="mt-2 text-sm text-ink/80">
              {file.filename} still has open findings. Finalize it anyway?
            </p>
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs">
              {validationFailed && (
                <div>
                  <div className="font-semibold text-[#DC2626]">
                    Build / syntax check failed
                  </div>
                  <ul className="mt-1 space-y-1 text-ink/70">
                    {validation!.issues.map((i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="shrink-0">•</span>
                        {i}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {criticalIssues.length > 0 && (
                <div>
                  <div className="font-semibold text-[#DC2626]">
                    AI consistency check: {criticalIssues.length} critical issue
                    {criticalIssues.length === 1 ? "" : "s"}
                  </div>
                  <ul className="mt-1 space-y-1 text-ink/70">
                    {criticalIssues.map((c) => (
                      <li key={c} className="flex items-start gap-1.5">
                        <span className="shrink-0">•</span>
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOverride(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-sub transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmOverride(false);
                  onFinalize(finalToLock);
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
