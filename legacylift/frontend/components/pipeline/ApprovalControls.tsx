"use client";
// ApprovalControls — Right panel action buttons for approving, editing, or rejecting
// the current chunk or business rule. Reject requires a mandatory reason text field.
// Override mode forces approval with a reason for audit trail.
//
// TODO: Wire the pause pipeline button to a POST /api/projects/{id}/pause endpoint.
// TODO: Add keyboard shortcuts: A = Approve, R = Reject, P = Pause.

import { useState } from "react";
import { CheckCircle2, XCircle, Edit3, PauseCircle, AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { ChunkStatus } from "@/types/legacylift";

interface ApprovalControlsProps {
  chunkId: string;
  chunkName: string;
  status: ChunkStatus;
  onApprove: (chunkId: string) => Promise<void>;
  onReject: (chunkId: string, reason: string) => Promise<void>;
  onPause?: () => void;
  loading?: boolean;
}

export function ApprovalControls({
  chunkId,
  chunkName,
  status,
  onApprove,
  onReject,
  onPause,
  loading = false,
}: ApprovalControlsProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);

  const handle = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const isReady = status === "Review";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[#222222] bg-[#111111] p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[#888888]">Review</span>
        <StatusBadge value={status} />
      </div>

      <div>
        <p className="text-sm font-semibold text-white">{chunkName}</p>
        <p className="text-xs text-[#888888]">{chunkId}</p>
      </div>

      {/* Action buttons — only enabled when status is Review */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => handle(() => onApprove(chunkId))}
          disabled={!isReady || busy || loading}
          className="flex items-center justify-center gap-2 rounded-lg bg-[#00C48C]/10 px-4 py-2.5 text-sm font-semibold text-[#00C48C] border border-[#00C48C]/30 hover:bg-[#00C48C]/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CheckCircle2 className="h-4 w-4" />
          Approve
        </button>

        {!rejecting ? (
          <button
            onClick={() => setRejecting(true)}
            disabled={!isReady || busy || loading}
            className="flex items-center justify-center gap-2 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-2.5 text-sm font-semibold text-[#EF4444] hover:bg-[#EF4444]/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <XCircle className="h-4 w-4" />
            Reject
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/5 p-3">
            <label className="text-xs text-[#EF4444]">Rejection reason (required)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe what needs to be fixed…"
              rows={3}
              className="w-full rounded bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-[#444444] border border-[#222222] focus:border-[#EF4444] focus:outline-none resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setRejecting(false); setReason(""); }}
                className="flex-1 rounded bg-[#222222] py-1.5 text-xs text-[#888888] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handle(() => onReject(chunkId, reason))}
                disabled={reason.trim().length < 10 || busy}
                className="flex-1 rounded bg-[#EF4444]/20 py-1.5 text-xs font-semibold text-[#EF4444] hover:bg-[#EF4444]/30 transition-colors disabled:opacity-40"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        )}

        {/* Override with reason */}
        {!overriding ? (
          <button
            onClick={() => setOverriding(true)}
            className="flex items-center justify-center gap-2 rounded-lg border border-[#F59E0B]/30 px-4 py-2 text-xs text-[#F59E0B] hover:bg-[#F59E0B]/10 transition-colors"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Override with reason
          </button>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-3">
            <div className="flex items-center gap-1 text-xs text-[#F59E0B]">
              <AlertTriangle className="h-3 w-3" />
              Override reason (logged for audit)
            </div>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why are you overriding the review result?"
              rows={2}
              className="w-full rounded bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-[#444444] border border-[#222222] focus:border-[#F59E0B] focus:outline-none resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setOverriding(false); setOverrideReason(""); }}
                className="flex-1 rounded bg-[#222222] py-1.5 text-xs text-[#888888] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handle(() => onApprove(chunkId))}
                disabled={overrideReason.trim().length < 10 || busy}
                className="flex-1 rounded bg-[#F59E0B]/20 py-1.5 text-xs font-semibold text-[#F59E0B] hover:bg-[#F59E0B]/30 transition-colors disabled:opacity-40"
              >
                Approve Override
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pause pipeline */}
      <div className="mt-2 border-t border-[#222222] pt-3">
        <button
          onClick={onPause}
          className="flex w-full items-center justify-center gap-2 py-1.5 text-xs text-[#444444] hover:text-[#888888] transition-colors"
        >
          <PauseCircle className="h-3.5 w-3.5" />
          Pause pipeline
        </button>
      </div>
    </div>
  );
}
