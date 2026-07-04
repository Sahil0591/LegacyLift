"use client";
// AIReviewPanel - Displays the Layer 2 AI review findings: critical issues (blocking),
// warnings (non-blocking), and optional improvement suggestions.
// Populated by the ai_review_complete WebSocket event.
//
// TODO: Add a "Re-run AI review" button that posts to a retry endpoint.
// TODO: Show the raw_response in a collapsible "debug" section for power users.

import { XCircle, AlertTriangle, Lightbulb, CheckCircle2 } from "lucide-react";
import type { AIReviewResult } from "@/types/legacylift";

const PLACEHOLDER: AIReviewResult = {
  issues_found: 2,
  critical_issues: [
    "Integer division on line 3: use Decimal to avoid losing cents in monetary calculations.",
  ],
  warnings: [
    "Magic number 100 should be extracted to a named constant PERCENTAGE_DIVISOR.",
    "Function lacks a docstring - add one for auditability.",
  ],
  suggestions: [
    "Consider adding a type alias: Money = Decimal for readability.",
  ],
  ai_confidence: "High",
  raw_response: "",
};

interface AIReviewPanelProps {
  review: AIReviewResult | null;
}

export function AIReviewPanel({ review }: AIReviewPanelProps) {
  const r = review ?? PLACEHOLDER;
  const isPlaceholder = !review;

  const allClear =
    r.critical_issues.length === 0 && r.warnings.length === 0;

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">AI Review</h2>
        <div className="flex items-center gap-2">
          {isPlaceholder && <span className="text-xs text-[#444444]">placeholder</span>}
          <span className="rounded-full bg-[#2563EB]/10 px-2.5 py-0.5 text-xs text-[#2563EB]">
            Confidence: {r.ai_confidence}
          </span>
        </div>
      </div>

      {allClear ? (
        <div className="flex items-center gap-2 text-sm text-[#00C48C]">
          <CheckCircle2 className="h-4 w-4" />
          No issues found. Looks good to approve.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Critical issues */}
          {r.critical_issues.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[#EF4444]">
                Critical ({r.critical_issues.length}) - must fix before approving
              </p>
              <div className="flex flex-col gap-2">
                {r.critical_issues.map((issue, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/5 px-3 py-2"
                  >
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-[#EF4444]" />
                    <span className="text-xs text-[#EF4444]">{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {r.warnings.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[#F59E0B]">
                Warnings ({r.warnings.length})
              </p>
              <div className="flex flex-col gap-2">
                {r.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-[#F59E0B]/20 bg-[#F59E0B]/5 px-3 py-2"
                  >
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-[#F59E0B]" />
                    <span className="text-xs text-[#888888]">{w}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {r.suggestions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[#888888]">Suggestions</p>
              <div className="flex flex-col gap-1.5">
                {r.suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[#444444]" />
                    <span className="text-xs text-[#888888]">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
