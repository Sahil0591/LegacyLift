"use client";
// FileSummaryModal - an AI explanation of what a WHOLE file does (not a chunk),
// in two registers: a technical summary for engineers and a plain-language one
// for non-technical stakeholders. Grounded in the file's extracted business
// rules and the human-authored institutional context.

import { Code2, Loader2, MessageSquareText, RotateCcw, X } from "lucide-react";
import type { FileSummary } from "@/lib/migration";

interface FileSummaryModalProps {
  filename: string;
  summary: FileSummary | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRegenerate: () => void;
}

// Minimal markdown-ish renderer: a lead paragraph plus "- "/"* " bullets. Good
// enough for the short summaries the model returns, with no extra dependency.
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={key} className="my-1.5 space-y-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm text-ink/80">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#7C3AED]" />
            <span>{b}</span>
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t) {
      flush(`u${i}`);
      return;
    }
    const bullet = t.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
    } else {
      flush(`u${i}`);
      out.push(
        <p key={`p${i}`} className="text-sm leading-relaxed text-ink/85">
          {t}
        </p>,
      );
    }
  });
  flush("uend");
  return <div className="space-y-1.5">{out}</div>;
}

function Section({
  Icon,
  title,
  subtitle,
  accent,
  body,
}: {
  Icon: typeof Code2;
  title: string;
  subtitle: string;
  accent: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-surface/40 p-4">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `${accent}1f`, color: accent }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-[11px] text-sub">{subtitle}</p>
        </div>
      </div>
      {body.trim() ? (
        <RichText text={body} />
      ) : (
        <p className="text-sm italic text-sub">No summary returned for this section.</p>
      )}
    </div>
  );
}

export function FileSummaryModal({
  filename,
  summary,
  loading,
  error,
  onClose,
  onRegenerate,
}: FileSummaryModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-base shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-ink/10 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">What this file does</h2>
            <p className="truncate font-mono text-xs text-sub">{filename}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {summary && !loading && (
              <button
                onClick={onRegenerate}
                title="Regenerate the summary"
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:border-[#7C3AED]/50 hover:text-[#7C3AED]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Regenerate
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-sub transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#7C3AED]" />
              <p className="text-sm text-sub">Reading the whole file and writing both summaries…</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[#DC2626]/30 bg-[#DC2626]/10 px-4 py-3 text-sm text-[#DC2626]">
              {error}
              <button
                onClick={onRegenerate}
                className="mt-2 block text-xs font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          ) : summary ? (
            <div className="space-y-4">
              <Section
                Icon={Code2}
                title="For developers"
                subtitle="Technical summary - responsibilities, flow, side effects, risks"
                accent="#3B82F6"
                body={summary.technical}
              />
              <Section
                Icon={MessageSquareText}
                title="In plain English"
                subtitle="For product, compliance & ops - what it does and why it matters"
                accent="#10B981"
                body={summary.layman}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
