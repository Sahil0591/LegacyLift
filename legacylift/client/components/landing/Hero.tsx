"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Github, ArrowRight } from "lucide-react";
import { SAMPLE_REPO } from "@/lib/startMigration";

const EASE = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState(SAMPLE_REPO);

  // Hand the typed repo off to the migration page with the URL prefilled — the
  // user picks source/target language there and kicks off the analysis, so the
  // landing page stays a fast, no-network entry point.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = repoUrl.trim();
    if (!url) return;
    router.push(`/demo?repo=${encodeURIComponent(url)}`);
  };

  return (
    <section className="relative px-6 pb-8 pt-20 sm:pt-28">
      <div className="mx-auto max-w-3xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#7C3AED]/20 bg-surface/60 px-4 py-1.5 text-xs font-medium text-[#7C3AED] backdrop-blur"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#7C3AED]" />
          Conduct AI Track · Imperial College London
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05, ease: EASE }}
          className="text-5xl font-bold leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-[4.25rem]"
        >
          Migrate legacy code
          <br />
          <span className="bg-gradient-to-r from-[#7C3AED] to-[#A855F7] bg-clip-text text-transparent">
            without losing the why.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12, ease: EASE }}
          className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-sub"
        >
          Paste a repository. LegacyLift maps every business rule and
          dependency, scores the risk, and migrates it chunk by chunk — with a
          human approving every single step.
        </motion.p>

        {/* Repo input — the live entry point into the migration flow */}
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
          className="mx-auto mt-9 flex max-w-xl flex-col gap-2.5 sm:flex-row"
        >
          <div className="glass flex flex-1 items-center gap-2.5 rounded-xl px-4 py-3 transition-colors focus-within:ring-1 focus-within:ring-[#7C3AED]/50">
            <Github className="h-4 w-4 shrink-0 text-sub" />
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              spellCheck={false}
              placeholder="github.com/org/repo"
              aria-label="Repository URL"
              className="w-full bg-transparent font-mono text-sm text-ink outline-none placeholder:text-[#a8a29e]"
            />
          </div>
          <button
            type="submit"
            disabled={repoUrl.trim().length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Map my codebase
            <ArrowRight className="h-4 w-4" />
          </button>
        </motion.form>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 font-mono text-[11px] text-sub"
        >
          <span>tree-sitter parsing</span>
          <span className="text-ink/30">·</span>
          <span>GPT-4o reasoning</span>
          <span className="text-ink/30">·</span>
          <span>pytest verification</span>
          <span className="text-ink/30">·</span>
          <span>human-gated merges</span>
        </motion.div>
      </div>
    </section>
  );
}
