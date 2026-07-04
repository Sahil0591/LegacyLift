"use client";

import { motion } from "framer-motion";
import { GitCommitHorizontal, ShieldCheck, UserCheck } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

function reveal(delay = 0) {
  return {
    initial: { opacity: 0, y: 28 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-60px" },
    transition: { duration: 0.55, delay, ease: EASE },
  };
}

// ── Card 1 visual: blame line traced to a decision ──────────────────────────
function ArchaeologyVisual() {
  return (
    <div className="rounded-xl border border-ink/8 bg-ink/[0.02] p-3 font-mono text-[11px]">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-ink/65">
          APPLY-LATE-FEE
        </span>
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">
          Tom K. · Finance
        </span>
      </div>
      <div className="mt-2 border-t border-dashed border-ink/10 pt-2 text-[10px] text-sub">
        decided in <span className="text-[#7C3AED]">PR #142</span> - "regulatory
        cap, 2019"
      </div>
    </div>
  );
}

// ── Card 2 visual: deterministic risk rule ──────────────────────────────────
function RiskVisual() {
  const tiers = [
    { c: "#10B981", w: "30%" },
    { c: "#F59E0B", w: "55%" },
    { c: "#F97316", w: "75%" },
    { c: "#DC2626", w: "95%" },
  ];
  return (
    <div className="rounded-xl border border-ink/8 bg-ink/[0.02] p-3">
      <div className="mb-2.5 font-mono text-[10px] text-sub">
        score = money·3 + fan_in·2 + low_conf
      </div>
      <div className="space-y-1.5">
        {tiers.map((t, i) => (
          <div key={i} className="h-1.5 overflow-hidden rounded-full bg-ink/6">
            <div
              className="h-full rounded-full"
              style={{ width: t.w, background: t.c }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Card 3 visual: the three gates ──────────────────────────────────────────
function ApprovalVisual() {
  return (
    <div className="rounded-xl border border-ink/8 bg-ink/[0.02] p-3">
      <div className="flex gap-1.5">
        <span className="flex-1 rounded-lg bg-[#7C3AED] py-1.5 text-center text-[10px] font-semibold text-white">
          Approve
        </span>
        <span className="flex-1 rounded-lg border border-ink/12 bg-surface py-1.5 text-center text-[10px] font-semibold text-sub">
          Edit
        </span>
        <span className="flex-1 rounded-lg border border-ink/12 bg-surface py-1.5 text-center text-[10px] font-semibold text-sub">
          Reject
        </span>
      </div>
      <div className="mt-2 text-center font-mono text-[10px] text-sub">
        every chunk · no exceptions
      </div>
    </div>
  );
}

const CARDS = [
  {
    Icon: GitCommitHorizontal,
    title: "It reads the history, not just the code.",
    body: "Every function is traced to the commit, PR, and team that shaped it - so you migrate the intent, not just the syntax.",
    Visual: ArchaeologyVisual,
  },
  {
    Icon: ShieldCheck,
    title: "Risk you can audit, not a vibe.",
    body: "Tiers come from explicit rules - money keywords, call fan-in, extraction confidence. No black-box score you have to trust blindly.",
    Visual: RiskVisual,
  },
  {
    Icon: UserCheck,
    title: "Nothing merges without you.",
    body: "The pipeline hard-stops at every chunk. Approve, edit, or reject - a human is the final gate on all 12 migrations, every time.",
    Visual: ApprovalVisual,
  },
];

export function WhyDifferent() {
  return (
    <section className="px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <motion.div {...reveal()} className="mb-14 max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Built for the questions that
            <span className="text-[#7C3AED]"> actually stall migrations.</span>
          </h2>
          <p className="mt-3 text-sub">
            Not a code translator. A system of record for why your legacy code
            does what it does - with a human in the loop the whole way.
          </p>
        </motion.div>

        <div className="grid gap-5 md:grid-cols-3">
          {CARDS.map(({ Icon, title, body, Visual }, i) => (
            <motion.div
              key={title}
              {...reveal(i * 0.1)}
              className="glass-card flex flex-col gap-4 rounded-2xl p-5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#7C3AED]/10">
                <Icon className="h-5 w-5 text-[#7C3AED]" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold leading-snug text-ink">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-sub">
                  {body}
                </p>
              </div>
              <div className="mt-auto pt-1">
                <Visual />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Stats */}
        <motion.div
          {...reveal(0.15)}
          className="glass mt-6 grid grid-cols-2 gap-6 rounded-2xl px-8 py-7 sm:grid-cols-4"
        >
          {[
            { v: "< 1 min", l: "to map a 400-function repo" },
            { v: "100%", l: "of decisions traced to a commit" },
            { v: "0", l: "chunks merged without sign-off" },
            { v: "3–5", l: "tests generated per rule" },
          ].map((s) => (
            <div key={s.l} className="text-center">
              <div className="text-2xl font-bold text-[#7C3AED]">{s.v}</div>
              <div className="mt-1 text-xs leading-tight text-sub">
                {s.l}
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
