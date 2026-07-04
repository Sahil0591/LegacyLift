"use client";
// BusinessRuleList - Scrollable list of BusinessRuleCards with filter/sort controls.
// Filters by status and ownership category. Shows a live counter of pending rules.
//
// TODO: Add a "Confirm all" bulk action for trusted high-confidence rules.
// TODO: Add search by keyword across title + description.

import { useState } from "react";
import { BusinessRuleCard } from "@/components/layer0/BusinessRuleCard";
import type { BusinessRule, OwnershipCategory, RuleStatus } from "@/types/legacylift";

const STATUS_FILTERS: Array<RuleStatus | "All"> = [
  "All", "Pending", "Confirmed", "Edited", "Flagged",
];

interface BusinessRuleListProps {
  rules: BusinessRule[];
  onStatusChange: (ruleId: string, newStatus: RuleStatus) => void;
  onReviewAction?: Parameters<typeof BusinessRuleCard>[0]["onReviewAction"];
}

export function BusinessRuleList({ rules, onStatusChange, onReviewAction }: BusinessRuleListProps) {
  const [statusFilter, setStatusFilter] = useState<RuleStatus | "All">("All");
  const [ownerFilter, setOwnerFilter] = useState<OwnershipCategory | "All">("All");

  const pendingCount = rules.filter((r) => r.status === "Pending").length;

  const owners = Array.from(
    new Set(rules.map((r) => r.ownership_category)),
  ).sort();

  const filtered = rules.filter((r) => {
    const statusOk = statusFilter === "All" || r.status === statusFilter;
    const ownerOk = ownerFilter === "All" || r.ownership_category === ownerFilter;
    return statusOk && ownerOk;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Business Rules</h2>
          {pendingCount > 0 && (
            <p className="text-xs text-[#F59E0B]">
              {pendingCount} rule{pendingCount !== 1 ? "s" : ""} awaiting review
            </p>
          )}
        </div>
        <span className="text-xs text-[#888888]">{filtered.length} / {rules.length}</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Status filter chips */}
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "bg-[#2563EB] text-white"
                  : "bg-[#111111] border border-[#222222] text-[#888888] hover:border-[#444444]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Owner filter */}
        <select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value as OwnershipCategory | "All")}
          className="rounded-lg border border-[#222222] bg-[#111111] px-2 py-1 text-xs text-[#888888] focus:border-[#2563EB] focus:outline-none"
        >
          <option value="All">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>

      {/* Rule cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[#222222] bg-[#111111] p-8 text-center text-sm text-[#444444]">
          {rules.length === 0 ? "Waiting for Layer 0 to extract rules…" : "No rules match the current filter."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((rule) => (
            <BusinessRuleCard
              key={rule.id}
              rule={rule}
              onStatusChange={onStatusChange}
              onReviewAction={onReviewAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
