"use client";
// MigrationComplete — Full-screen celebration panel shown when migration_complete
// WebSocket event arrives. Shows final statistics and download/export options.
//
// TODO: Wire "Download migrated code" to a ZIP export endpoint on the backend.
// TODO: Add confetti animation (canvas-confetti or similar) for the hackathon demo.

import { motion } from "framer-motion";
import { CheckCircle2, Download, FileCode2, Clock } from "lucide-react";

interface MigrationCompleteProps {
  projectId: string;
  totalChunks: number;
  approvedChunks: number;
}

export function MigrationComplete({
  projectId,
  totalChunks,
  approvedChunks,
}: MigrationCompleteProps) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-8 py-16 text-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, type: "spring" }}
    >
      {/* Icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        className="flex h-24 w-24 items-center justify-center rounded-full bg-[#00C48C]/10 border border-[#00C48C]/30"
      >
        <CheckCircle2 className="h-12 w-12 text-[#00C48C]" />
      </motion.div>

      <div>
        <h1 className="text-3xl font-bold text-white">Migration Complete</h1>
        <p className="mt-2 text-[#888888]">
          All chunks reviewed and approved. The migrated codebase is ready.
        </p>
        <p className="mt-1 text-xs text-[#444444]">Project {projectId}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-6">
        {[
          { icon: FileCode2, label: "Chunks migrated", value: approvedChunks, colour: "#00C48C" },
          { icon: CheckCircle2, label: "Approval rate", value: `${Math.round((approvedChunks / Math.max(totalChunks, 1)) * 100)}%`, colour: "#2563EB" },
          { icon: Clock, label: "Layers complete", value: "4 / 4", colour: "#F59E0B" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col items-center gap-1 rounded-xl border border-[#222222] bg-[#111111] px-6 py-4"
          >
            <stat.icon className="h-5 w-5" style={{ color: stat.colour }} />
            <span className="text-2xl font-bold" style={{ color: stat.colour }}>
              {stat.value}
            </span>
            <span className="text-xs text-[#888888]">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <button className="flex items-center gap-2 rounded-lg bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
          <Download className="h-4 w-4" />
          Download migrated code
          {/* TODO: href to /api/projects/{projectId}/export */}
        </button>
        <button className="flex items-center gap-2 rounded-lg border border-[#222222] px-6 py-3 text-sm font-semibold text-[#888888] hover:text-white hover:border-[#444444] transition-colors">
          View full report
          {/* TODO: link to a /project/{id}/report page */}
        </button>
      </div>
    </motion.div>
  );
}
