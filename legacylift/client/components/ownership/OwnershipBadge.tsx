// OwnershipBadge — Compact ownership summary block for a single business rule.
// Shows primary category (colour-coded), confidence level, evidence text,
// and the actual person name/email if found in git history or docs.
//
// TODO: Make the actual_person field a mailto: link when an email is detected.

import { User, Shield, Info } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { OwnershipCategory, OwnershipConfidence } from "@/types/legacylift";

interface OwnershipBadgeProps {
  category: OwnershipCategory;
  confidence: OwnershipConfidence;
  evidence: string;
  actualPerson: string | null;
}

export function OwnershipBadge({
  category,
  confidence,
  evidence,
  actualPerson,
}: OwnershipBadgeProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[#222222] bg-[#0a0a0a] px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <Shield className="h-3.5 w-3.5 text-[#888888]" />
        <StatusBadge value={category} />
        <span className="text-xs text-[#888888]">
          confidence:{" "}
          <span
            className={
              confidence === "High"
                ? "text-[#00C48C]"
                : confidence === "Medium"
                ? "text-[#F59E0B]"
                : "text-[#EF4444]"
            }
          >
            {confidence}
          </span>
        </span>
      </div>

      {evidence && (
        <div className="flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-0.5 shrink-0 text-[#444444]" />
          <span className="text-xs text-[#888888]">{evidence}</span>
        </div>
      )}

      {actualPerson && (
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 shrink-0 text-[#2563EB]" />
          <span className="text-xs text-[#2563EB]">{actualPerson}</span>
        </div>
      )}
    </div>
  );
}
