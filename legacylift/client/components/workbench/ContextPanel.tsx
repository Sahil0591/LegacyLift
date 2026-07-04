"use client";
// ContextPanel — the "README for the AI agent". Lets a domain expert author
// institutional context the AI can't infer from source (systems, copybooks,
// regulatory caps, naming conventions, target architecture) — project-wide and
// per file. Everything here is injected, as authoritative context, into every
// migration and review call for the relevant file.

import { useMemo, useState } from "react";
import {
  BookMarked,
  ChevronDown,
  ChevronRight,
  FileText,
  Search,
} from "lucide-react";
import type { ProjectConfig } from "@/lib/projectConfig";

const GLOBAL_MAX = 6000;
const FILE_MAX = 3000;

const GLOBAL_PLACEHOLDER = `Tell the AI how your organization's systems actually work. For example:

• Systems & data: "COMP-3 money fields are GBP pence. Account numbers are 10 digits, zero-padded."
• External systems: "RATE-TABLE is loaded from the quarterly regulatory feed — treat its values as config, not constants."
• Compliance do-nots: "The £25.00 late-fee cap is a 2019 FCA limit — never change it."
• Target architecture: "Migrate into our service template; import shared money utils from acme.finance.money."
• Conventions: "Prefer snake_case; keep business-rule names traceable to the copybook."`;

function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max * 0.9;
  return (
    <span className={`font-mono text-[10px] ${over ? "text-[#F59E0B]" : "text-sub/60"}`}>
      {value.length.toLocaleString()}/{max.toLocaleString()}
    </span>
  );
}

interface ContextPanelProps {
  config: ProjectConfig;
  filenames: string[];
  onGlobalChange: (text: string) => void;
  onFileChange: (filename: string, text: string) => void;
}

export function ContextPanel({
  config,
  filenames,
  onGlobalChange,
  onFileChange,
}: ContextPanelProps) {
  const [open, setOpen] = useState(true);
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const perFile = config.context.perFile;
  const withContext = filenames.filter((f) => (perFile[f] ?? "").trim().length > 0).length;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? filenames.filter((f) => f.toLowerCase().includes(q)) : filenames;
  }, [filenames, query]);

  const toggle = (filename: string) =>
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });

  return (
    <div className="overflow-hidden rounded-xl border border-ink/10 bg-surface/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ink/[0.02] ${
          open ? "border-b border-ink/10" : ""
        }`}
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#7C3AED]/12 text-[#7C3AED]">
          <BookMarked className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">Migration context &amp; instructions</h3>
          <p className="mt-0.5 text-xs text-sub">
            Sent with every migration — like a README the AI reads before touching your code.
          </p>
        </div>
        {open ? (
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-sub" />
        ) : (
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-sub" />
        )}
      </button>

      {open && (
      <div className="space-y-5 p-5">
        {/* Project-wide */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="ctx-global" className="text-xs font-semibold text-ink">
              Context for the whole codebase
            </label>
            <CharCount value={config.context.global} max={GLOBAL_MAX} />
          </div>
          <textarea
            id="ctx-global"
            value={config.context.global}
            maxLength={GLOBAL_MAX}
            onChange={(e) => onGlobalChange(e.target.value)}
            rows={7}
            placeholder={GLOBAL_PLACEHOLDER}
            className="w-full resize-y rounded-lg border border-ink/15 bg-base px-3 py-2.5 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-sub/45 focus:border-[#7C3AED]"
          />
        </div>

        {/* Per-file */}
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs font-semibold text-ink">File-specific context</span>
            <span className="font-mono text-[11px] text-sub">
              {withContext}/{filenames.length} files annotated
            </span>
            {filenames.length > 6 && (
              <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink/12 bg-base px-2 py-1">
                <Search className="h-3 w-3 text-sub" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter files…"
                  className="w-32 bg-transparent text-xs text-ink outline-none placeholder:text-sub/50"
                />
              </div>
            )}
          </div>

          {filenames.length === 0 ? (
            <p className="text-xs text-sub">No files yet.</p>
          ) : (
            <div className="divide-y divide-ink/[0.06] overflow-hidden rounded-lg border border-ink/10">
              {shown.map((filename) => {
                const open = openFiles.has(filename);
                const text = perFile[filename] ?? "";
                const has = text.trim().length > 0;
                return (
                  <div key={filename}>
                    <button
                      onClick={() => toggle(filename)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-ink/[0.03]"
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sub" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sub" />
                      )}
                      <FileText className="h-3.5 w-3.5 shrink-0 text-sub/70" />
                      <span className="min-w-0 truncate font-mono text-xs text-ink/90">
                        {filename}
                      </span>
                      {has && (
                        <span
                          title="Has file-specific context"
                          className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#7C3AED]"
                        />
                      )}
                    </button>
                    {open && (
                      <div className="px-3 pb-3 pt-0.5">
                        <div className="mb-1 flex justify-end">
                          <CharCount value={text} max={FILE_MAX} />
                        </div>
                        <textarea
                          value={text}
                          maxLength={FILE_MAX}
                          onChange={(e) => onFileChange(filename, e.target.value)}
                          rows={4}
                          placeholder={`Anything the AI must know when migrating ${filename} specifically — copybooks it can't change, ordering it must preserve, the system it talks to…`}
                          className="w-full resize-y rounded-lg border border-ink/15 bg-base px-3 py-2 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-sub/45 focus:border-[#7C3AED]"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {shown.length === 0 && (
                <p className="px-3 py-2.5 text-xs text-sub">No files match “{query}”.</p>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
