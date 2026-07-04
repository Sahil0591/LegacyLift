"use client";
// BusinessRuleCard - Single card for one extracted business rule.
// Shows title, description, source location, confidence badge, warnings,
// hardcoded values, and the OwnershipBadge. Inline Confirm/Edit/Flag actions.
//
// TODO: Add an inline edit form for the description field (status → Edited).
// TODO: Highlight the source_lines range in a miniature code snippet viewer.

import { useState } from "react";
import { AlertTriangle, Hash, MapPin, ChevronDown, ChevronUp } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { OwnershipBadge } from "@/components/ownership/OwnershipBadge";
import type { BusinessRule, RuleStatus } from "@/types/legacylift";

type RuleReviewAction =
  | "confirm_owner"
  | "reassign_owner"
  | "flag"
  | "request_approval"
  | "mark_approved"
  | "waive_approval";

interface BusinessRuleCardProps {
  rule: BusinessRule;
  onStatusChange: (ruleId: string, newStatus: RuleStatus) => void;
  onReviewAction?: (
    ruleId: string,
    action: RuleReviewAction,
    payload?: { owner?: string; reason?: string },
  ) => void;
}

export function BusinessRuleCard({ rule, onStatusChange, onReviewAction }: BusinessRuleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const currentOwner = rule.current_owner ?? rule.ownership_category;
  const originalOwner = rule.original_inferred_owner ?? rule.ownership_category;
  const reviewState = rule.review_state ?? (rule.status === "Pending" ? "Inferred" : rule.status === "Flagged" ? "Flagged" : "Confirmed");
  const approvalState = rule.approval_state ?? "Approval needed";
  const guidance = rule.change_guidance;

  const performAction = (action: RuleReviewAction) => {
    if (action === "reassign_owner") {
      const owner = window.prompt("New owner", currentOwner);
      if (!owner) return;
      const reason = window.prompt("Reason for reassignment", "") ?? "";
      onReviewAction?.(rule.id, action, { owner, reason });
      return;
    }
    if (action === "waive_approval") {
      const reason = window.prompt("Reason for waiving approval", "") ?? "";
      if (!reason.trim()) return;
      onReviewAction?.(rule.id, action, { reason });
      return;
    }
    onReviewAction?.(rule.id, action);
  };

  const confidenceColour: Record<string, string> = {
    High: "text-[#00C48C]",
    Medium: "text-[#F59E0B]",
    Low: "text-[#EF4444]",
  };

  return (
    <div
      className={`rounded-xl border bg-[#111111] transition-colors ${
        rule.status === "Flagged"
          ? "border-[#EF4444]/40"
          : rule.status === "Confirmed"
          ? "border-[#00C48C]/30"
          : "border-[#222222]"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-[#444444]">{rule.id}</span>
            <StatusBadge value={rule.status} />
            <StatusBadge value={rule.confidence} />
            <StatusBadge value={reviewState} />
            <StatusBadge value={approvalState} />
          </div>
          <h3 className="mt-1 text-sm font-semibold text-white">{rule.title}</h3>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="ml-2 shrink-0 text-[#444444] hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Source location */}
      <div className="flex items-center gap-1.5 px-4 pb-3 text-xs text-[#888888]">
        <MapPin className="h-3 w-3" />
        <span>
          {rule.source_file} · lines {rule.source_lines[0]}–{rule.source_lines[1]}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[#222222] p-4 flex flex-col gap-3">
          {/* Description */}
          <p className="text-sm leading-relaxed text-[#888888]">{rule.description}</p>

          {/* Hardcoded values */}
          {rule.hardcoded_values.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Hash className="h-3.5 w-3.5 text-[#F59E0B]" />
              {rule.hardcoded_values.map((v) => (
                <code
                  key={v}
                  className="rounded bg-[#F59E0B]/10 px-1.5 py-0.5 text-xs text-[#F59E0B]"
                >
                  {v}
                </code>
              ))}
            </div>
          )}

          {/* Warnings */}
          {rule.warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              {rule.warnings.map((w) => (
                <div key={w} className="flex items-start gap-1.5 text-xs text-[#EF4444]">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Ownership */}
          <OwnershipBadge
            category={currentOwner}
            confidence={rule.ownership_confidence}
            evidence={rule.ownership_evidence}
            actualPerson={rule.ownership_detail?.actual_person ?? null}
          />

          <div className="grid gap-2 rounded-lg border border-[#222222] bg-[#0B0B0B] p-3 text-xs text-[#888888] sm:grid-cols-2">
            <div>
              <span className="block text-[#444444]">Current owner</span>
              <span className="font-semibold text-white">{currentOwner}</span>
            </div>
            <div>
              <span className="block text-[#444444]">Original inferred owner</span>
              <span className="font-semibold text-white">{originalOwner}</span>
            </div>
            <div>
              <span className="block text-[#444444]">Review state</span>
              <span className="font-semibold text-white">{reviewState}</span>
            </div>
            <div>
              <span className="block text-[#444444]">Approval state</span>
              <span className="font-semibold text-white">{approvalState}</span>
            </div>
          </div>

          {guidance && (
            <div className="space-y-2 rounded-lg border border-[#222222] bg-[#0B0B0B] p-3 text-xs text-[#888888]">
              {guidance.risk_summary && <p>{guidance.risk_summary}</p>}
              {guidance.approval_checklist.length > 0 && (
                <ul className="list-disc space-y-1 pl-4">
                  {guidance.approval_checklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Review actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {rule.status === "Pending" && (
              <button
                onClick={() => {
                  onStatusChange(rule.id, "Confirmed");
                  performAction("confirm_owner");
                }}
                className="rounded bg-[#00C48C]/10 px-3 py-1.5 text-xs font-semibold text-[#00C48C] border border-[#00C48C]/20 hover:bg-[#00C48C]/20 transition-colors"
              >
                Confirm
              </button>
            )}
            {rule.status === "Pending" && (
              <button
                onClick={() => onStatusChange(rule.id, "Edited")}
                className="rounded bg-[#F59E0B]/10 px-3 py-1.5 text-xs font-semibold text-[#F59E0B] border border-[#F59E0B]/20 hover:bg-[#F59E0B]/20 transition-colors"
              >
                Edit
              </button>
            )}
            {rule.status === "Pending" && (
              <button
                onClick={() => {
                  onStatusChange(rule.id, "Flagged");
                  performAction("flag");
                }}
                className="rounded bg-[#EF4444]/10 px-3 py-1.5 text-xs font-semibold text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/20 transition-colors"
              >
                Flag
              </button>
            )}
            <button
              onClick={() => performAction("reassign_owner")}
              className="rounded bg-[#2563EB]/10 px-3 py-1.5 text-xs font-semibold text-[#2563EB] border border-[#2563EB]/20 hover:bg-[#2563EB]/20 transition-colors"
            >
              Reassign
            </button>
            <button
              onClick={() => performAction("request_approval")}
              className="rounded bg-[#F59E0B]/10 px-3 py-1.5 text-xs font-semibold text-[#F59E0B] border border-[#F59E0B]/20 hover:bg-[#F59E0B]/20 transition-colors"
            >
              Request approval
            </button>
            <button
              onClick={() => performAction("mark_approved")}
              className="rounded bg-[#00C48C]/10 px-3 py-1.5 text-xs font-semibold text-[#00C48C] border border-[#00C48C]/20 hover:bg-[#00C48C]/20 transition-colors"
            >
              Mark approved
            </button>
            <button
              onClick={() => performAction("waive_approval")}
              className="rounded bg-[#888888]/10 px-3 py-1.5 text-xs font-semibold text-[#888888] border border-[#888888]/20 hover:bg-[#888888]/20 transition-colors"
            >
              Waive
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
