"use client";
// FileContextPanel — the review workbench's 3rd (right-hand) panel: the full
// original source file, with the chunk currently under review highlighted.
// Collapsible so it doesn't compete for space when not needed.

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";

interface FileContextPanelProps {
  filename: string;
  content: string;
  activeStartLine: number;
  activeEndLine: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function FileContextPanel({
  filename,
  content,
  activeStartLine,
  activeEndLine,
  collapsed,
  onToggleCollapse,
}: FileContextPanelProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) {
      activeRef.current?.scrollIntoView({ block: "center" });
    }
  }, [filename, activeStartLine, collapsed]);

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 py-3">
        <button
          onClick={onToggleCollapse}
          title="Show file context"
          className="rounded-lg p-1.5 text-sub transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <FileText className="h-4 w-4 text-sub/50" />
      </div>
    );
  }

  const lines = content.split("\n");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink/10 px-3 py-3">
        <FileText className="h-3.5 w-3.5 shrink-0 text-sub" />
        <span className="min-w-0 truncate font-mono text-xs text-ink/80">
          {filename || "No file"}
        </span>
        <button
          onClick={onToggleCollapse}
          title="Collapse"
          className="ml-auto shrink-0 rounded-lg p-1 text-sub transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {!content ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-sub">
          Full file context not available for this chunk.
        </div>
      ) : (
        <div className="flex-1 overflow-auto py-2 font-mono text-[12px] leading-[1.75]">
          {lines.map((line, i) => {
            const lineNo = i + 1;
            const active = lineNo >= activeStartLine && lineNo <= activeEndLine;
            return (
              <div
                key={i}
                ref={active && lineNo === activeStartLine ? activeRef : undefined}
                className={`flex px-3 ${active ? "bg-[#7C3AED]/10" : ""}`}
              >
                <span className="w-8 shrink-0 select-none pr-3 text-right text-sub/35">
                  {lineNo}
                </span>
                <code className="whitespace-pre text-ink/90">{line || " "}</code>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
