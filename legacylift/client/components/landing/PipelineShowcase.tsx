"use client";
// PipelineShowcase — Static visual of the layer pipeline with animated
// connecting lines between each stage card.
//
// TODO: Make this interactive — clicking a layer card should show a modal
// with a detailed description of what that layer does.

import { motion } from "framer-motion";
import { Search, Target, ArrowRightLeft, ShieldCheck } from "lucide-react";

const LAYERS = [
  {
    icon: Search,
    id: "layer0",
    label: "Layer 0",
    name: "Archaeology",
    description: "Extract business rules, map dependencies, score risk",
    colour: "#2563EB",
  },
  {
    icon: Target,
    id: "layer0_5",
    label: "Layer 0.5",
    name: "Target Profile",
    description: "Fetch docs, map deprecations, register gotchas",
    colour: "#7C3AED",
  },
  {
    icon: ArrowRightLeft,
    id: "migration",
    label: "Layers 1–3",
    name: "Migration",
    description: "Static analysis → AI review → test generation",
    colour: "#F59E0B",
  },
  {
    icon: ShieldCheck,
    id: "validation",
    label: "Layer 4",
    name: "Validation",
    description: "Full integration test suite on migrated codebase",
    colour: "#00C48C",
  },
];

export function PipelineShowcase() {
  return (
    <section className="py-24 px-6 bg-[#111111]/50">
      <div className="mx-auto max-w-screen-xl">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            The pipeline
          </h2>
          <p className="mt-4 text-[#888888]">
            Every layer runs in sequence. Every layer requires human approval before the next begins.
          </p>
        </div>

        {/* Pipeline cards with connecting arrows */}
        <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-stretch lg:gap-0">
          {LAYERS.map((layer, i) => (
            <div key={layer.id} className="flex flex-col items-center lg:flex-row lg:flex-1">
              {/* Layer card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.15 }}
                className="flex w-full max-w-xs flex-col gap-3 rounded-xl border border-[#222222] bg-[#111111] p-6 lg:max-w-none"
                style={{ borderTopColor: layer.colour, borderTopWidth: 2 }}
              >
                <div className="flex items-center gap-2">
                  <layer.icon className="h-5 w-5" style={{ color: layer.colour }} />
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ background: `${layer.colour}20`, color: layer.colour }}
                  >
                    {layer.label}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-white">{layer.name}</h3>
                <p className="text-sm text-[#888888]">{layer.description}</p>
              </motion.div>

              {/* Connecting arrow — hidden after last item */}
              {i < LAYERS.length - 1 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: i * 0.15 + 0.3 }}
                  className="flex items-center justify-center py-2 text-[#444444] lg:px-2 lg:py-0"
                >
                  <svg className="h-6 w-6 lg:h-4 lg:w-4 rotate-90 lg:rotate-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </motion.div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
