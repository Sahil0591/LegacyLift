"use client";
// TestResults - Pass/fail grid for each auto-generated test case.
// Updates in real time as test_result WebSocket events stream in during Layer 3.
// Shows test name, pass/fail icon, and duration. Failed tests show error details.
//
// TODO: Add a "Show pytest output" expandable section for each failed test.
// TODO: Show a coverage % badge once the backend emits coverage data.

import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { TestResult } from "@/types/legacylift";

const PLACEHOLDER_TESTS: TestResult[] = [
  { name: "test_interest_calc_tier1_boundary", passed: true, error_message: null, duration_ms: 12.4 },
  { name: "test_interest_calc_zero_balance", passed: true, error_message: null, duration_ms: 8.1 },
  { name: "test_interest_calc_negative_guard", passed: false, error_message: "AssertionError: expected 0 but got -0.01\n  File test_calc.py:34 in test_interest_calc_negative_guard", duration_ms: 9.7 },
  { name: "test_interest_calc_large_balance", passed: true, error_message: null, duration_ms: 11.2 },
];

interface TestResultsProps {
  results: TestResult[];
  running?: boolean;
}

export function TestResults({ results, running = false }: TestResultsProps) {
  const display = results.length === 0 ? PLACEHOLDER_TESTS : results;
  const isPlaceholder = results.length === 0;
  const passed = display.filter((t) => t.passed).length;
  const failed = display.filter((t) => !t.passed).length;

  return (
    <div className="rounded-xl border border-[#222222] bg-[#111111] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Test Results</h2>
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2563EB]" />}
          {isPlaceholder && <span className="text-xs text-[#444444]">placeholder</span>}
        </div>
        <div className="flex gap-3 text-xs">
          <span className="text-[#00C48C]">{passed} passed</span>
          {failed > 0 && <span className="text-[#EF4444]">{failed} failed</span>}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {display.map((test) => (
          <div key={test.name} className="flex flex-col">
            <div
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                test.passed ? "bg-[#00C48C]/5" : "bg-[#EF4444]/5"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {test.passed ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#00C48C]" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-[#EF4444]" />
                )}
                <span className="font-mono text-xs text-[#888888] truncate">{test.name}</span>
              </div>
              <span className="ml-2 shrink-0 text-xs text-[#444444]">
                {test.duration_ms.toFixed(1)}ms
              </span>
            </div>

            {/* Error details */}
            {!test.passed && test.error_message && (
              <pre className="mt-1 rounded-b bg-[#EF4444]/5 border border-[#EF4444]/20 px-3 py-2 text-xs text-[#EF4444] overflow-x-auto whitespace-pre-wrap">
                {test.error_message}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
