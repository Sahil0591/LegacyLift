"use client";
// CTASection — Bottom call-to-action section on the landing page.
// Emphasises the hackathon track and the time savings pitch.
//
// TODO: Add a demo video embed or animated GIF showing the workbench in action.

import { motion } from "framer-motion";
import Link from "next/link";

export function CTASection() {
  return (
    <section className="py-24 px-6">
      <motion.div
        className="mx-auto max-w-3xl rounded-2xl border border-[#222222] bg-[#111111] p-12 text-center"
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <div className="mb-4 inline-flex items-center rounded-full border border-[#2563EB]/30 bg-[#2563EB]/10 px-4 py-1.5 text-xs text-[#2563EB]">
          Built for the Conduct AI track
        </div>

        <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">
          What takes consultants{" "}
          <span className="text-[#EF4444]">6 months</span>{" "}
          takes{" "}
          <span className="bg-gradient-to-r from-[#2563EB] to-[#00C48C] bg-clip-text text-transparent">
            a day.
          </span>
        </h2>

        <p className="mt-4 text-[#888888]">
          Stop paying COBOL consultants $500/hour to read code nobody understands.
          Let LegacyLift read it, extract it, and migrate it — with a human in the loop at every critical step.
        </p>

        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/demo"
            className="rounded-lg bg-[#2563EB] px-8 py-3 text-base font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            Try the demo
          </Link>
          <a
            href="https://github.com/Sahil0591/LegacyLift"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-[#222222] px-8 py-3 text-base font-semibold text-[#888888] hover:text-white hover:border-[#444444] transition-colors"
          >
            View on GitHub
          </a>
        </div>

        <p className="mt-8 text-xs text-[#444444]">
          No credit card required · Demo runs on sample COBOL payroll system
        </p>
      </motion.div>
    </section>
  );
}
