"use client";
// BusinessRuleCard — Single card for one extracted business rule.
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

interface BusinessRuleCardProps {
  rule: BusinessRule;
  onStatusChange: (ruleId: string, newStatus: RuleStatus) => void;
}

export function BusinessRuleCard({ rule, onStatusChange }: BusinessRuleCardProps) {
  const [expanded, setExpanded] = useState(false);

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
            category={rule.ownership_category}
            confidence={rule.ownership_confidence}
            evidence={rule.ownership_evidence}
            actualPerson={rule.ownership_detail?.actual_person ?? null}
          />

          {/* Review actions */}
          {rule.status === "Pending" && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onStatusChange(rule.id, "Confirmed")}
                className="rounded bg-[#00C48C]/10 px-3 py-1.5 text-xs font-semibold text-[#00C48C] border border-[#00C48C]/20 hover:bg-[#00C48C]/20 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => onStatusChange(rule.id, "Edited")}
                className="rounded bg-[#F59E0B]/10 px-3 py-1.5 text-xs font-semibold text-[#F59E0B] border border-[#F59E0B]/20 hover:bg-[#F59E0B]/20 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => onStatusChange(rule.id, "Flagged")}
                className="rounded bg-[#EF4444]/10 px-3 py-1.5 text-xs font-semibold text-[#EF4444] border border-[#EF4444]/20 hover:bg-[#EF4444]/20 transition-colors"
              >
                Flag
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
