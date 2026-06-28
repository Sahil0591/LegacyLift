"use client";
// HowItWorks — 4-step explainer section on the landing page.
// Each step fades in when it scrolls into view (Framer Motion viewport trigger).
//
// TODO: Replace placeholder icons with custom SVG illustrations for each step.

import { motion } from "framer-motion";
import { Upload, Brain, CheckSquare, Zap } from "lucide-react";

const STEPS = [
  {
    icon: Upload,
    number: "01",
    title: "Upload your legacy codebase",
    description:
      "Drag and drop COBOL, Java, or VB6 source files along with the SQL schema. LegacyLift handles the rest.",
  },
  {
    icon: Brain,
    number: "02",
    title: "AI understands everything",
    description:
      "Layer 0 extracts every business rule, maps dependencies between modules, assigns ownership, and scores risk — before touching a single line.",
  },
  {
    icon: CheckSquare,
    number: "03",
    title: "Review and confirm",
    description:
      "A domain expert approves each extracted rule. Nothing moves forward without sign-off. Full audit trail included.",
  },
  {
    icon: Zap,
    number: "04",
    title: "Migrate chunk by chunk",
    description:
      "Code is migrated in logical units. Each chunk passes static analysis, AI review, and auto-generated tests before landing in your review queue.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-6">
      <div className="mx-auto max-w-screen-xl">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">How it works</h2>
          <p className="mt-4 text-[#888888]">
            Four layers of intelligence. Zero guesswork.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative flex flex-col gap-4 rounded-xl border border-[#222222] bg-[#111111] p-6"
            >
              <div className="flex items-center justify-between">
                <step.icon className="h-6 w-6 text-[#2563EB]" />
                <span className="text-4xl font-bold text-[#222222]">{step.number}</span>
              </div>
              <h3 className="text-lg font-semibold text-white">{step.title}</h3>
              <p className="text-sm leading-relaxed text-[#888888]">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
