"use client";
// TargetProfile — Shows the migration target language/version/style guide profile.
// Populated by the target_profile_ready WebSocket event from Layer 0.5.

import { useState } from "react";
import type { TargetProfile as TargetProfileType } from "@/types/legacylift";

interface TargetProfileProps {
  profile: TargetProfileType | null;
}

export function TargetProfile({ profile }: TargetProfileProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  if (!profile) {
    return (
      <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
        <h2 className="mb-4 text-sm font-semibold text-white">Target Profile</h2>
        <p className="text-xs text-[#444444]">Awaiting analysis...</p>
      </div>
    );
  }

  const fields: Array<{ label: string; value: string }> = [
    { label: "Language",       value: profile.language },
    { label: "Version",        value: profile.version },
    { label: "Style guide",    value: profile.style_guide },
    { label: "Type system",    value: profile.type_system },
    { label: "Async model",    value: profile.async_model },
    { label: "Test framework", value: profile.test_framework },
  ];

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">Target Profile</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col gap-0.5">
            <span className="text-xs text-[#888888]">{f.label}</span>
            <span className="text-sm font-medium text-white">{f.value}</span>
          </div>
        ))}
      </div>

      {profile.notes && (
        <div className="mt-4 rounded-lg border border-[#222222] bg-[#0a0a0a] p-3">
          <p className="text-xs text-[#888888]">{profile.notes}</p>
        </div>
      )}

      {profile.recommended_libraries.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#888888]">
            Recommended Libraries
          </h3>
          <div className="flex flex-col gap-2">
            {profile.recommended_libraries.map((lib, idx) => (
              <div
                key={lib.name}
                className="rounded-lg border border-[#222222] bg-[#0a0a0a] p-3"
              >
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-white">{lib.name}</span>
                    <span className="mx-2 text-[#333333]">—</span>
                    <span className="text-xs text-[#666666]">{lib.purpose}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate text-xs text-[#00C48C]">{lib.import}</code>
                  <button
                    onClick={() => handleCopy(lib.import, idx)}
                    className="shrink-0 rounded bg-[#222222] px-2 py-0.5 text-xs text-[#888888] transition-colors hover:text-white"
                  >
                    {copiedIdx === idx ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
