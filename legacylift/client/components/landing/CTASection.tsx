"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Github, Clock, Check, Sparkles } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

const OLD_WAY = [
  "A team of specialists reading COBOL line by line",
  "Business logic locked in people's heads",
  "Big-bang cutover, fingers crossed",
];

const NEW_WAY = [
  "Every rule traced back to the commit that set it",
  "Risk-scored and migrated chunk by chunk",
  "A human approves every single merge",
];

export function CTASection() {
  return (
    <section className="px-6 py-24">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease: EASE }}
        className="glass-strong relative mx-auto max-w-4xl overflow-hidden rounded-3xl px-7 py-12 sm:px-12"
      >
        {/* corner glow */}
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-50"
          style={{
            background: "radial-gradient(circle, #C4B5FD 0%, transparent 70%)",
          }}
        />

        <div className="relative">
          <div className="mb-10 text-center">
            <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-[#7C3AED]/20 bg-[#7C3AED]/[0.07] px-3 py-1 text-xs font-medium text-[#7C3AED]">
              <Sparkles className="h-3 w-3" />
              The honest math
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-[2.6rem] sm:leading-[1.1]">
              Six months of consultants,
              <br className="hidden sm:block" /> or an{" "}
              <span className="bg-gradient-to-r from-[#7C3AED] to-[#A855F7] bg-clip-text text-transparent">
                afternoon.
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-sub">
              Migrating a legacy system usually means paying specialists £500/hour
              to relearn code nobody documented. LegacyLift does the reading — you
              do the deciding.
            </p>
          </div>

          {/* Before / after comparison */}
          <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
            {/* Old way */}
            <div className="rounded-2xl border border-ink/8 bg-ink/[0.02] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-sub" />
                <span className="text-xs font-semibold uppercase tracking-wide text-sub">
                  The consultant route
                </span>
              </div>
              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-ink">6 months</span>
                <span className="font-mono text-xs text-sub">≈ £480k</span>
              </div>
              <ul className="space-y-2">
                {OLD_WAY.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[13px] leading-snug text-sub"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sub/60" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Arrow */}
            <div className="flex items-center justify-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#7C3AED]/20 bg-[#7C3AED]/[0.07] text-[#7C3AED]">
                <ArrowRight className="h-4 w-4 sm:rotate-0 max-sm:rotate-90" />
              </div>
            </div>

            {/* New way */}
            <div className="rounded-2xl border border-[#7C3AED]/25 bg-[#7C3AED]/[0.05] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#7C3AED]" />
                <span className="text-xs font-semibold uppercase tracking-wide text-[#7C3AED]">
                  With LegacyLift
                </span>
              </div>
              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-ink">~1 day</span>
                <span className="font-mono text-xs text-sub">human-approved</span>
              </div>
              <ul className="space-y-2">
                {NEW_WAY.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-[13px] leading-snug text-ink/80"
                  >
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7C3AED]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* CTAs */}
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-full bg-[#7C3AED] px-8 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition-colors hover:bg-[#6D28D9]"
            >
              Try the demo
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="https://github.com/Sahil0591/LegacyLift"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-8 py-3 text-base font-semibold text-sub transition-colors hover:border-ink/30 hover:text-ink"
            >
              <Github className="h-4 w-4" />
              View on GitHub
            </a>
          </div>

          <p className="mt-7 text-center text-xs text-sub/70">
            tree-sitter parsing · GPT-4o reasoning · tests generated from confirmed
            rules, not code
          </p>
        </div>
      </motion.div>
    </section>
  );
}
