"use client";
// TargetProfile — Shows the migration target language/version/style guide profile.
// Populated by the target_profile_ready WebSocket event from Layer 0.5.
//
// TODO: Allow the user to override the auto-detected profile before migration begins.

import type { TargetProfile as TargetProfileType } from "@/types/legacylift";

const PLACEHOLDER: TargetProfileType = {
  language: "Python",
  version: "3.12",
  style_guide: "PEP 8 + Black formatter",
  type_system: "Fully typed (mypy strict)",
  async_model: "asyncio (FastAPI-compatible)",
  test_framework: "pytest + pytest-asyncio",
  notes: "TODO: Layer 0.5 will populate this from fetched migration docs.",
};

interface TargetProfileProps {
  profile: TargetProfileType | null;
}

export function TargetProfile({ profile }: TargetProfileProps) {
  const p = profile ?? PLACEHOLDER;

  const fields: Array<{ label: string; value: string }> = [
    { label: "Language", value: p.language },
    { label: "Version", value: p.version },
    { label: "Style guide", value: p.style_guide },
    { label: "Type system", value: p.type_system },
    { label: "Async model", value: p.async_model },
    { label: "Test framework", value: p.test_framework },
  ];

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Target Profile</h2>
        {!profile && (
          <span className="text-xs text-[#444444]">placeholder</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col gap-0.5">
            <span className="text-xs text-[#888888]">{f.label}</span>
            <span className="text-sm font-medium text-white">{f.value}</span>
          </div>
        ))}
      </div>

      {p.notes && (
        <div className="mt-4 rounded-lg border border-[#222222] bg-[#0a0a0a] p-3">
          <p className="text-xs text-[#888888]">{p.notes}</p>
        </div>
      )}
    </div>
  );
}
