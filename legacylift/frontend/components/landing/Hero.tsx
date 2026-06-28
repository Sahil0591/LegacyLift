"use client";
// Hero — Landing page hero section with headline, subheadline, CTA button,
// and an animated background of connected nodes rendered with Framer Motion.
//
// TODO: Make the node animation interactive (mouse parallax or hover attraction).

import { motion } from "framer-motion";
import Link from "next/link";

// Deterministic node positions so SSR and client match (avoids hydration mismatch)
const NODES = [
  { x: "10%", y: "20%", delay: 0 },
  { x: "85%", y: "15%", delay: 0.4 },
  { x: "25%", y: "75%", delay: 0.8 },
  { x: "70%", y: "65%", delay: 0.2 },
  { x: "50%", y: "40%", delay: 0.6 },
  { x: "90%", y: "80%", delay: 1.0 },
  { x: "5%",  y: "55%", delay: 1.2 },
  { x: "60%", y: "90%", delay: 0.3 },
];

const EDGES = [
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 5], [4, 6], [4, 7],
] as const;

export function Hero() {
  return (
    <section className="relative flex min-h-[90vh] flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* Animated background graph */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-20"
        aria-hidden="true"
      >
        {EDGES.map(([from, to]) => (
          <motion.line
            key={`${from}-${to}`}
            x1={NODES[from].x}
            y1={NODES[from].y}
            x2={NODES[to].x}
            y2={NODES[to].y}
            stroke="#2563EB"
            strokeWidth="1"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.5, delay: NODES[from].delay, ease: "easeOut" }}
          />
        ))}
        {NODES.map((node, i) => (
          <motion.circle
            key={i}
            cx={node.x}
            cy={node.y}
            r="5"
            fill="#2563EB"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: node.delay }}
          />
        ))}
      </svg>

      {/* Content */}
      <motion.div
        className="relative z-10 max-w-3xl"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      >
        <motion.div
          className="mb-4 inline-flex items-center rounded-full border border-[#222222] bg-[#111111] px-4 py-1.5 text-xs text-[#888888]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          Conduct AI Track · Hackathon 2026
        </motion.div>

        <h1 className="mb-6 text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
          Legacy code.{" "}
          <span className="bg-gradient-to-r from-[#2563EB] to-[#7C3AED] bg-clip-text text-transparent">
            Finally understood.
          </span>
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[#888888]">
          LegacyLift reads your entire legacy codebase, extracts every business rule,
          maps every dependency, and migrates it chunk by chunk — with a human
          approving every step.
        </p>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/demo"
            className="rounded-lg bg-[#2563EB] px-8 py-3 text-base font-semibold text-white shadow-lg shadow-blue-900/30 hover:bg-blue-500 transition-colors"
          >
            Start Migration
          </Link>
          <a
            href="#how-it-works"
            className="rounded-lg border border-[#222222] px-8 py-3 text-base font-semibold text-[#888888] hover:text-white hover:border-[#444444] transition-colors"
          >
            How it works ↓
          </a>
        </div>
      </motion.div>
    </section>
  );
}
