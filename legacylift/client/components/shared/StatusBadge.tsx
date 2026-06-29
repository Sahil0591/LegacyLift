// StatusBadge — Coloured pill badge for rule status, chunk status, risk level,
// and ownership category. Maps enum values to the LegacyLift design system colours.
//
// TODO: Add tooltip with description of what each status means for new users.

import type {
  ChunkStatus,
  OwnershipCategory,
  RiskLevel,
  RuleStatus,
} from "@/types/legacylift";

type BadgeVariant = RuleStatus | ChunkStatus | RiskLevel | OwnershipCategory;

const COLOUR_MAP: Record<string, string> = {
  // RuleStatus
  Pending: "bg-[#222222] text-[#888888]",
  Confirmed: "bg-[#00C48C]/20 text-[#00C48C]",
  Edited: "bg-[#F59E0B]/20 text-[#F59E0B]",
  Flagged: "bg-[#EF4444]/20 text-[#EF4444]",

  // ChunkStatus
  Running: "bg-[#2563EB]/20 text-[#2563EB] animate-pulse",
  Review: "bg-[#F59E0B]/20 text-[#F59E0B]",
  Approved: "bg-[#00C48C]/20 text-[#00C48C]",
  Rejected: "bg-[#EF4444]/20 text-[#EF4444]",

  // RiskLevel
  Low: "bg-[#00C48C]/20 text-[#00C48C]",
  Medium: "bg-[#F59E0B]/20 text-[#F59E0B]",
  High: "bg-[#EF4444]/20 text-[#EF4444]",
  Critical: "bg-[#7C3AED]/20 text-[#7C3AED]",

  // OwnershipCategory
  Finance: "bg-[#2563EB]/20 text-[#2563EB]",
  Compliance: "bg-[#7C3AED]/20 text-[#7C3AED]",
  Product: "bg-[#00C48C]/20 text-[#00C48C]",
  Risk: "bg-[#EF4444]/20 text-[#EF4444]",
  Ops: "bg-[#F59E0B]/20 text-[#F59E0B]",
  Engineering: "bg-[#888888]/20 text-[#888888]",
  Unknown: "bg-[#222222] text-[#888888]",
};

interface StatusBadgeProps {
  value: BadgeVariant;
  className?: string;
}

export function StatusBadge({ value, className = "" }: StatusBadgeProps) {
  const colours = COLOUR_MAP[value] ?? "bg-[#222222] text-[#888888]";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colours} ${className}`}
    >
      {value}
    </span>
  );
}
