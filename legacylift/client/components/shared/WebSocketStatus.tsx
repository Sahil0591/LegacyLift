"use client";
// WebSocketStatus - Compact connection indicator dot shown in the Navbar.
// Green pulse = connected, amber = connecting, red = error/disconnected.
//
// TODO: Add a tooltip showing last event time and reconnect attempt count.

import type { ConnectionStatus } from "@/types/legacylift";

const CONFIG: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: { dot: "bg-[#00C48C] animate-pulse", label: "Live" },
  connecting: { dot: "bg-[#F59E0B] animate-pulse", label: "Connecting…" },
  disconnected: { dot: "bg-[#888888]", label: "Disconnected" },
  error: { dot: "bg-[#EF4444] animate-pulse", label: "WS Error" },
};

interface WebSocketStatusProps {
  status: ConnectionStatus;
}

export function WebSocketStatus({ status }: WebSocketStatusProps) {
  const { dot, label } = CONFIG[status];
  return (
    <div className="flex items-center gap-1.5 text-xs text-[#888888]">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span>{label}</span>
    </div>
  );
}
