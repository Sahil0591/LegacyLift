"use client";
// TargetLanguageSelect — reusable dropdown over the target-language catalog.
// Used at project creation, for the project default on the Overview, and as a
// per-file override on each file row.

import { ChevronDown } from "lucide-react";
import { TARGET_LANGUAGES, getTargetLanguage } from "@/lib/targetLanguages";

interface TargetLanguageSelectProps {
  /** Selected target id. Empty string = "follow default" (only when allowDefault). */
  value: string;
  onChange: (targetId: string) => void;
  /** Include a leading "Default" option whose value is "" (per-file overrides). */
  allowDefault?: boolean;
  /** The id the "Default" option resolves to, so we can label it (e.g. Python 3). */
  defaultTargetId?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
}

function optionLabel(target: (typeof TARGET_LANGUAGES)[number]) {
  return target.status === "active_experimental" ? `${target.label} (experimental)` : target.label;
}

export function TargetLanguageSelect({
  value,
  onChange,
  allowDefault = false,
  defaultTargetId,
  size = "md",
  disabled = false,
  className = "",
  ariaLabel = "Target language",
  title,
}: TargetLanguageSelectProps) {
  const pad = size === "sm" ? "py-1 pl-2.5 pr-7 text-xs" : "py-2 pl-3 pr-8 text-sm";
  const defaultTarget = defaultTargetId ? getTargetLanguage(defaultTargetId) : null;
  const defaultLabel = defaultTarget ? `Default (${optionLabel(defaultTarget)})` : "Default";

  return (
    <div className={`relative inline-block ${className}`}>
      <select
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full appearance-none rounded-lg border border-ink/15 bg-surface/70 font-medium text-ink outline-none transition-colors hover:border-ink/30 focus:border-[#7C3AED] disabled:cursor-not-allowed disabled:opacity-50 ${pad}`}
      >
        {allowDefault && <option value="">{defaultLabel}</option>}
        {TARGET_LANGUAGES.map((t) => (
          <option key={t.id} value={t.id}>
            {optionLabel(t)}
          </option>
        ))}
      </select>
      <ChevronDown
        className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sub ${
          size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"
        }`}
      />
    </div>
  );
}
