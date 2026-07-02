"use client";
// ToastStack — bottom-right notification stack for background job feedback
// (chunk generation/checks finishing while the user is on Overview or another
// chunk). Styled to match the workbench's existing badge language in
// components/workbench/shared.tsx (rounded pills, `${color}1f` backgrounds).

import { CheckCircle2, AlertOctagon, Info, X } from "lucide-react";
import type { Toast, ToastVariant } from "@/hooks/useToasts";

const VARIANT_META: Record<ToastVariant, { color: string; Icon: typeof CheckCircle2 }> = {
  success: { color: "#10B981", Icon: CheckCircle2 },
  error: { color: "#DC2626", Icon: AlertOctagon },
  info: { color: "#7C3AED", Icon: Info },
};

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => {
        const { color, Icon } = VARIANT_META[toast.variant];
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-ink/10 bg-surface p-3 shadow-lg backdrop-blur-xl"
          >
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ background: `${color}1f`, color }}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-xs text-sub">{toast.description}</p>
              )}
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    onDismiss(toast.id);
                  }}
                  className="mt-1.5 text-xs font-semibold text-[#7C3AED] hover:underline"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 text-sub hover:text-ink"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
