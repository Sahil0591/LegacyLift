"use client";
// RiskScorePanel — Shows per-file risk scores as a sorted bar chart list.
// Populated by the risk_scores_ready WebSocket event.
// Colour codes: low → green, medium → amber, high → red, critical → purple.
//
// TODO: Make each bar clickable to filter the BusinessRuleList to that file.
// TODO: Add a sparkline showing how risk distribution has changed across retries.

interface RiskScorePanelProps {
  scores: Record<string, number>;
}

function riskColour(score: number): string {
  if (score >= 0.8) return "#7C3AED";
  if (score >= 0.6) return "#EF4444";
  if (score >= 0.35) return "#F59E0B";
  return "#00C48C";
}

function riskLabel(score: number): string {
  if (score >= 0.8) return "Critical";
  if (score >= 0.6) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}

export function RiskScorePanel({ scores }: RiskScorePanelProps) {
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">Risk Scores</h2>

      {sorted.length === 0 ? (
        <p className="text-xs text-[#444444]">Waiting for risk analysis…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map(([file, score]) => {
            const colour = riskColour(score);
            const label = riskLabel(score);
            return (
              <div key={file} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-[#888888] truncate max-w-[70%]">{file}</span>
                  <span style={{ color: colour }} className="font-semibold">
                    {label} ({(score * 100).toFixed(0)}%)
                  </span>
                </div>
                {/* Bar */}
                <div className="h-1.5 w-full rounded-full bg-[#222222]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${score * 100}%`, background: colour }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
