"use client";

import { motion, useScroll, useTransform } from "framer-motion";

/**
 * Page-wide ambient background: two soft gradient orbs + a faint dot grid,
 * fixed behind all content with a gentle scroll-driven parallax. Sits at -z-10
 * so the glass panels above blur it for the liquid-glass effect.
 */
export function AmbientBackground() {
  const { scrollYProgress } = useScroll();
  const yA = useTransform(scrollYProgress, [0, 1], [0, -160]);
  const yB = useTransform(scrollYProgress, [0, 1], [0, 120]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <motion.div
        style={{ y: yA }}
        className="absolute -right-40 -top-40 h-[760px] w-[760px] rounded-full opacity-50"
      >
        <div
          className="h-full w-full"
          style={{
            background: "radial-gradient(circle, #C4B5FD 0%, transparent 68%)",
          }}
        />
      </motion.div>

      <motion.div
        style={{ y: yB }}
        className="absolute -left-40 top-[55%] h-[640px] w-[640px] rounded-full opacity-40"
      >
        <div
          className="h-full w-full"
          style={{
            background: "radial-gradient(circle, #E9D5FF 0%, transparent 68%)",
          }}
        />
      </motion.div>

      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <pattern
            id="ambient-dots"
            width="26"
            height="26"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1.5" cy="1.5" r="1" className="dot-grid" opacity="0.05" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ambient-dots)" />
      </svg>
    </div>
  );
}
