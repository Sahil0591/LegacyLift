"use client";
// DeprecationMap — Table mapping legacy language constructs to their Python equivalents.
// Data is fetched by Layer 0.5 from official migration docs and stored on the project.
//
// TODO: Populate this from the target_profile_ready event payload when the backend
// adds a deprecation_map field to the TargetProfile model.

import type { DeprecationEntry } from "@/types/legacylift";

const PLACEHOLDER_ENTRIES: DeprecationEntry[] = [
  {
    legacy_construct: "COMPUTE … ROUNDED",
    python_equivalent: "decimal.Decimal with ROUND_HALF_UP",
    notes: "Python float loses cents — always use Decimal for money.",
  },
  {
    legacy_construct: "MOVE SPACES TO var",
    python_equivalent: "var = ''",
    notes: "COBOL SPACES fills with ASCII 0x20; Python empty string is correct.",
  },
  {
    legacy_construct: "PERFORM … UNTIL",
    python_equivalent: "while not condition:",
    notes: "COBOL tests at start of loop by default.",
  },
  {
    legacy_construct: "CALL 'DB2-MODULE'",
    python_equivalent: "await db.execute(sql, params)",
    notes: "TODO: Layer 0.5 will map specific DB2 call signatures to SQLAlchemy async.",
  },
];

interface DeprecationMapProps {
  entries?: DeprecationEntry[];
}

export function DeprecationMap({ entries }: DeprecationMapProps) {
  const rows = entries ?? PLACEHOLDER_ENTRIES;

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Deprecation Map</h2>
        {!entries && (
          <span className="text-xs text-[#444444]">placeholder</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#222222] text-left text-[#888888]">
              <th className="pb-2 pr-4 font-medium">Legacy construct</th>
              <th className="pb-2 pr-4 font-medium">Python equivalent</th>
              <th className="pb-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, i) => (
              <tr
                key={i}
                className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors"
              >
                <td className="py-2.5 pr-4">
                  <code className="text-[#F59E0B]">{entry.legacy_construct}</code>
                </td>
                <td className="py-2.5 pr-4">
                  <code className="text-[#00C48C]">{entry.python_equivalent}</code>
                </td>
                <td className="py-2.5 text-[#888888]">{entry.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
