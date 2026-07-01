"use client";
// BulkFinalizeModal — combined review screen for finalizing several
// cluster-ready files in one pass. Each file gets its own on-demand
// consistency check (same mechanism as FileFinalizeModal, just looped);
// one "Finalize all" action commits the whole batch once reviewed.

import { useState } from "react";
import {
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { AIReviewResult } from "@/types/legacylift";
import type { FileGroup } from "@/hooks/useFileStatus";
import { assembleFile, concatenateSource } from "@/lib/fileAssembly";
import { reviewMigration } from "@/lib/migration";
import { makeLesson, type Lesson } from "@/lib/lessons";

interface BulkFinalizeModalProps {
  open: boolean;
  onClose: () => void;
  files: FileGroup[];
  onLessonLearned?: (lesson: Lesson) => void;
  onFinalizeAll: (filenames: string[]) => void;
}

interface FileCheckState {
  checking: boolean;
  error: string | null;
  review: AIReviewResult | null;
  hasChecked: boolean;
}

export function BulkFinalizeModal({
  open,
  onClose,
  files,
  onLessonLearned,
  onFinalizeAll,
}: BulkFinalizeModalProps) {
  const [expanded, setExpanded] = useState<string | null>(files[0]?.filename ?? null);
  const [checks, setChecks] = useState<Record<string, FileCheckState>>({});
  const [confirmCritical, setConfirmCritical] = useState(false);

  if (!open) return null;

  const allChecked = files.every((f) => checks[f.filename]?.hasChecked);
  const allHaveCode = files.every((f) =>
    f.chunks.every((c) => c.migrated_code.trim().length > 0),
  );
  const canFinalizeAll = files.length > 0 && allChecked && allHaveCode;
  const finalizeBlockedReason = !allHaveCode
    ? "Some files have chunks with no migrated code yet"
    : !allChecked
      ? "Run the check for every file before finalizing"
      : undefined;
  const filesWithCritical = files.filter(
    (f) => (checks[f.filename]?.review?.critical_issues.length ?? 0) > 0,
  );

  const requestFinalizeAll = () => {
    if (filesWithCritical.length > 0) setConfirmCritical(true);
    else onFinalizeAll(files.map((f) => f.filename));
  };

  const runCheck = async (file: FileGroup) => {
    setChecks((prev) => ({
      ...prev,
      [file.filename]: { checking: true, error: null, review: null, hasChecked: false },
    }));
    const source = concatenateSource(file.chunks);
    const assembled = assembleFile(file.filename, file.chunks);
    try {
      const result = await reviewMigration({
        name: file.filename,
        sourceCode: source,
        migratedCode: assembled,
      });
      setChecks((prev) => ({
        ...prev,
        [file.filename]: { checking: false, error: null, review: result, hasChecked: true },
      }));
      for (const text of [...result.critical_issues, ...result.warnings]) {
        onLessonLearned?.(
          makeLesson({ source: "file_check", sourceFile: file.filename, text }),
        );
      }
    } catch (err) {
      setChecks((prev) => ({
        ...prev,
        [file.filename]: {
          checking: false,
          hasChecked: true,
          review: null,
          error:
            err instanceof Error
              ? err.message
              : "File too large for a single consistency pass — per-chunk reviews already ran.",
        },
      }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-ink/10 bg-base shadow-2xl">
        <div className="flex items-center gap-3 border-b border-ink/10 px-6 py-4">
          <h2 className="text-base font-semibold text-ink">
            Finalize {files.length} file{files.length === 1 ? "" : "s"}
          </h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-sub transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 divide-y divide-ink/[0.06] overflow-y-auto">
          {files.map((file) => {
            const isOpen = expanded === file.filename;
            const check = checks[file.filename];
            return (
              <div key={file.filename}>
                <button
                  onClick={() => setExpanded(isOpen ? null : file.filename)}
                  className="flex w-full items-center gap-2 px-6 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sub" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sub" />
                  )}
                  <span className="font-mono text-sm font-medium text-ink">
                    {file.filename}
                  </span>
                  <span className="font-mono text-xs text-sub">
                    {file.totalCount} unit{file.totalCount === 1 ? "" : "s"}
                  </span>
                  {check?.hasChecked && (
                    <span className="ml-auto text-xs text-sub">
                      {check.review
                        ? `${check.review.issues_found} note${check.review.issues_found === 1 ? "" : "s"}`
                        : "check failed"}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="space-y-3 px-6 pb-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-sub">
                        {file.approvedCount}/{file.totalCount} units approved
                      </span>
                      <button
                        onClick={() => runCheck(file)}
                        disabled={check?.checking}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#7C3AED]/30 px-3 py-1.5 text-xs font-semibold text-[#7C3AED] transition-colors hover:bg-[#7C3AED]/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {check?.checking ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        {check?.checking ? "Checking…" : "Run check"}
                      </button>
                    </div>
                    {check?.error && (
                      <div className="flex items-start gap-2 text-xs text-[#F59E0B]">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {check.error}
                      </div>
                    )}
                    {check?.review && (
                      <div className="space-y-1.5 text-xs">
                        {check.review.critical_issues.map((c) => (
                          <div key={c} className="flex items-start gap-2 text-[#DC2626]">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            {c}
                          </div>
                        ))}
                        {check.review.warnings.map((w) => (
                          <div key={w} className="flex items-start gap-2 text-ink/70">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#F59E0B]" />
                            {w}
                          </div>
                        ))}
                        {check.review.issues_found === 0 && (
                          <div className="text-sub">No issues found.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-ink/10 bg-surface/40 px-6 py-4">
          <p className="mr-auto text-sm text-sub">
            Finalizing locks every listed file in for download.
          </p>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-sub transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={requestFinalizeAll}
            disabled={!canFinalizeAll}
            title={finalizeBlockedReason}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCircle2 className="h-4 w-4" />
            Finalize all {files.length}
          </button>
        </div>
      </div>

      {confirmCritical && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="w-full max-w-md rounded-xl border border-ink/10 bg-base p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#DC2626]">
              <AlertOctagon className="h-4 w-4" />
              Critical issues in {filesWithCritical.length} file
              {filesWithCritical.length === 1 ? "" : "s"}
            </div>
            <p className="mt-2 text-sm text-ink/80">
              The final check flagged critical issues. Are you sure you want to
              finalize all {files.length} files anyway?
            </p>
            <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-xs text-ink/70">
              {filesWithCritical.map((f) => (
                <li key={f.filename}>
                  <span className="font-mono text-ink/90">{f.filename}</span>
                  <ul className="mt-0.5 space-y-0.5 pl-3">
                    {(checks[f.filename]?.review?.critical_issues ?? []).map((c) => (
                      <li key={c} className="flex items-start gap-1.5">
                        <span className="shrink-0">•</span>
                        {c}
                      </li>
                    ))}
                  </ul>
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
                  onFinalizeAll(files.map((f) => f.filename));
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
