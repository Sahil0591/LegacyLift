"use client";
// CodeCompare — side-by-side "before / after" view for a migration.
// COBOL → Python is a translation, not a line diff, so we show two clean,
// independently-readable code panels with light syntax emphasis (keywords +
// comments) rather than red/green word-diff noise.

import { useState, type ReactNode } from "react";
import { ArrowRight, Pencil, X, Check } from "lucide-react";

type Lang = "cobol" | "python";

const COBOL_KW =
  /\b(IDENTIFICATION|DIVISION|SECTION|PROGRAM-ID|PERFORM|COMPUTE|MOVE|IF|ELSE|END-IF|ADD|SUBTRACT|MULTIPLY|DIVIDE|GIVING|ROUNDED|WRITE|READ|SEARCH|WHEN|EXIT|STRING|CALL|USING|VARYING|UNTIL|EVALUATE|TO|FROM|INTO)\b/g;
const PY_KW =
  /\b(def|return|if|elif|else|for|while|in|import|from|class|with|as|lambda|raise|try|except|and|or|not|None|True|False)\b/g;

function renderLine(line: string, lang: Lang): ReactNode {
  if (line.trim() === "") return " ";

  const fullComment =
    lang === "cobol" ? /^\s*\*/.test(line) : /^\s*#/.test(line);
  if (fullComment) {
    return <span className="italic text-sub/60">{line}</span>;
  }

  let codePart = line;
  let commentPart = "";
  if (lang === "python") {
    const h = line.indexOf("#");
    if (h >= 0) {
      codePart = line.slice(0, h);
      commentPart = line.slice(h);
    }
  }

  const kw = lang === "cobol" ? COBOL_KW : PY_KW;
  kw.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = kw.exec(codePart)) !== null) {
    if (m.index > last) out.push(codePart.slice(last, m.index));
    out.push(
      <span key={`${m.index}-k`} className="font-medium text-violet-600 dark:text-violet-300">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < codePart.length) out.push(codePart.slice(last));
  if (commentPart) {
    out.push(
      <span key="cmt" className="italic text-sub/60">
        {commentPart}
      </span>,
    );
  }
  return out;
}

function CodePanel({
  title,
  accent,
  meta,
  lang,
  code,
}: {
  title: string;
  accent: string;
  meta: string;
  lang: Lang;
  code: string;
}) {
  const lines = code.split("\n");
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: accent }}
          />
          <span className="text-xs font-semibold text-ink/80">{title}</span>
        </div>
        <span className="font-mono text-[10px] text-sub/60">{meta}</span>
      </div>
      <div className="overflow-x-auto py-2 font-mono text-[12.5px] leading-[1.75]">
        {lines.map((line, i) => (
          <div key={i} className="flex px-3">
            <span className="w-7 shrink-0 select-none pr-3 text-right text-sub/35">
              {i + 1}
            </span>
            <code className="whitespace-pre text-ink/90">
              {renderLine(line, lang)}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditableMigratedPanel({
  code,
  onSave,
}: {
  code: string;
  onSave: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: "#7C3AED" }} />
            <span className="text-xs font-semibold text-ink/80">Migrated · Python 3.12</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-sub/60">{code.split("\n").length} lines</span>
            <button
              onClick={() => {
                setDraft(code);
                setEditing(true);
              }}
              title="Edit this code directly, right here next to the source"
              className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-1.5 py-0.5 text-[10px] font-semibold text-ink/70 transition-colors hover:border-[#7C3AED]/50 hover:text-[#7C3AED]"
            >
              <Pencil className="h-2.5 w-2.5" />
              Edit
            </button>
          </div>
        </div>
        <div className="overflow-x-auto py-2 font-mono text-[12.5px] leading-[1.75]">
          {code.split("\n").map((line, i) => (
            <div key={i} className="flex px-3">
              <span className="w-7 shrink-0 select-none pr-3 text-right text-sub/35">
                {i + 1}
              </span>
              <code className="whitespace-pre text-ink/90">{renderLine(line, "python")}</code>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: "#7C3AED" }} />
          <span className="text-xs font-semibold text-ink/80">Migrated · Python 3.12</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing(false)}
            className="inline-flex items-center gap-1 rounded-full border border-ink/15 px-1.5 py-0.5 text-[10px] font-semibold text-ink/70 transition-colors hover:text-ink"
          >
            <X className="h-2.5 w-2.5" />
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
            className="inline-flex items-center gap-1 rounded-full bg-[#7C3AED] px-1.5 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-[#6D28D9]"
          >
            <Check className="h-2.5 w-2.5" />
            Save
          </button>
        </div>
      </div>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="min-h-[240px] flex-1 resize-y bg-transparent p-3 font-mono text-[12.5px] leading-[1.75] text-ink/90 outline-none"
      />
    </div>
  );
}

export function CodeCompare({
  source,
  migrated,
  onSaveEdit,
}: {
  source: string;
  migrated: string;
  /** When present, the migrated panel gets an "Edit" toggle for hand-fixing code directly. */
  onSaveEdit?: (code: string) => void;
}) {
  return (
    <div className="relative grid grid-cols-1 divide-y divide-ink/10 overflow-hidden rounded-xl border border-ink/10 bg-surface/40 md:grid-cols-2 md:divide-x md:divide-y-0">
      <CodePanel
        title="Legacy · COBOL"
        accent="#6B7280"
        meta={`${source.split("\n").length} lines`}
        lang="cobol"
        code={source}
      />
      {onSaveEdit ? (
        <EditableMigratedPanel code={migrated} onSave={onSaveEdit} />
      ) : (
        <CodePanel
          title="Migrated · Python 3.12"
          accent="#7C3AED"
          meta={`${migrated.split("\n").length} lines`}
          lang="python"
          code={migrated}
        />
      )}
      {/* center translate marker (desktop) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-ink/10 bg-base text-[#7C3AED] shadow-sm">
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}
