"use client";
// useToasts — lightweight toast queue for background job feedback (generation
// finishing, checks failing, etc.) while the user has navigated elsewhere.
// No portal/animation library — ToastStack renders the list directly.

import { useCallback, useRef, useState } from "react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  action?: ToastAction;
}

const AUTO_DISMISS_MS: Record<ToastVariant, number> = {
  success: 6000,
  info: 6000,
  error: 8000,
};

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev, { ...toast, id }]);
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS[toast.variant]);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}
