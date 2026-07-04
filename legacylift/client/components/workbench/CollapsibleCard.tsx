"use client";
// CollapsibleCard — the shared card chrome for the Overview's sections. A
// titled, bordered panel whose body collapses/expands from a chevron on the
// header. `actions` render on the right of the header (counts, controls) and
// are NOT part of the toggle, so a target selector or "Finalize all" button in
// the header keeps working without toggling the section.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function CollapsibleCard({
  title,
  actions,
  defaultOpen = true,
  tourId,
  children,
}: {
  title: string;
  /** Controls/counts rendered on the right of the header — not part of the toggle. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** `data-tour` attribute for the guided walkthrough. */
  tourId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      data-tour={tourId}
      className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40"
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 ${
          open ? "border-b border-ink/10" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group -my-1 flex items-center gap-2 py-1 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-sub transition-colors group-hover:text-ink" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-sub transition-colors group-hover:text-ink" />
          )}
          <span className="text-sm font-semibold text-ink">{title}</span>
        </button>
        {actions && (
          <div className="flex flex-wrap items-center gap-3">{actions}</div>
        )}
      </div>
      {open && children}
    </div>
  );
}
