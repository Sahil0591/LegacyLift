// lib/staticCheck.ts — deterministic static analysis of generated Python.
// Runs in the browser (no Python runtime needed): bracket/quote balance, a
// definition sanity check, placeholder detection, and a cyclomatic-ish score.

import type { StaticAnalysisResult } from "@/types/legacylift";

function balanced(code: string): boolean {
  const close: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  let inStr: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (inStr) {
      if (ch === inStr && code[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== close[ch]) return false;
    }
  }
  return stack.length === 0 && inStr === null;
}

export function staticAnalyze(code: string): StaticAnalysisResult {
  const lines = code.split("\n");
  const issues: string[] = [];

  if (!balanced(code)) {
    issues.push("Unbalanced brackets or quotes");
  }
  if (!/\b(def|class)\s+\w+/.test(code)) {
    issues.push("No function or class definition found");
  }
  const placeholderOnly =
    /^\s*pass\s*$/m.test(code) && code.trim().split("\n").length < 4;
  if (
    placeholderOnly ||
    /\b(TODO|FIXME|NotImplementedError)\b/i.test(code) ||
    code.trim().length < 5
  ) {
    issues.push("Generated code looks like a placeholder");
  }

  const complexity =
    (code.match(/\b(if|elif|else|for|while|except|and|or)\b/g) ?? []).length + 1;

  return {
    passed: issues.length === 0,
    issues,
    complexity_score: complexity,
    line_count: lines.length,
  };
}
