"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Github,
  Lock,
  FolderGit2,
  FileCode2,
  Network,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  Check,
  Pencil,
  X,
  Play,
  Pause,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Stage definitions
// ─────────────────────────────────────────────────────────────────────────────

type StageId = "connect" | "map" | "deps" | "risk" | "migrate" | "approve";

const STAGES: {
  id: StageId;
  label: string;
  hint: string;
  Icon: typeof Github;
}[] = [
  { id: "connect", label: "Connect", hint: "Clone & index", Icon: Github },
  { id: "map", label: "Map", hint: "Find what matters", Icon: FolderGit2 },
  { id: "deps", label: "Dependencies", hint: "Trace the calls", Icon: Network },
  { id: "risk", label: "Risk", hint: "Score every node", Icon: ShieldAlert },
  { id: "migrate", label: "Migrate", hint: "Generate + test", Icon: Sparkles },
  { id: "approve", label: "Approve", hint: "Human signs off", Icon: CheckCircle2 },
];

const DURATION: Record<StageId, number> = {
  connect: 3200,
  map: 3800,
  deps: 3400,
  risk: 3800,
  migrate: 4000,
  approve: 3800,
};

const RISK = {
  low: { color: "#10B981", label: "Low" },
  medium: { color: "#F59E0B", label: "Medium" },
  high: { color: "#F97316", label: "High" },
  critical: { color: "#DC2626", label: "Critical" },
} as const;

type RiskLevel = keyof typeof RISK;

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

function fade(delay = 0) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] as const },
  };
}

function RiskTag({ level }: { level: RiskLevel }) {
  const r = RISK[level];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${r.color}1A`, color: r.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
      {r.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Connect
// ─────────────────────────────────────────────────────────────────────────────

function ConnectStage() {
  return (
    <div className="flex h-full flex-col justify-center gap-6 px-2">
      <motion.div {...fade(0)}>
        <div className="mb-2 text-xs font-medium text-sub">
          Repository
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-surface px-3 py-2.5 shadow-sm">
          <Github className="h-4 w-4 shrink-0 text-ink/60" />
          <span className="flex-1 truncate font-mono text-sm text-ink">
            github.com/acme-bank/loan-engine
          </span>
          <span className="rounded-lg bg-[#7C3AED] px-3 py-1 text-xs font-semibold text-white">
            Analyze
          </span>
        </div>
      </motion.div>

      <motion.div
        {...fade(0.7)}
        className="rounded-xl border border-ink/8 bg-ink/[0.02] p-4"
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="font-mono text-xs text-ink/70">
            Cloning repository…
          </span>
          <span className="font-mono text-[11px] text-sub">COBOL · 92.4k LOC</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-ink/8">
          <motion.div
            className="h-full rounded-full bg-[#7C3AED]"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.6, delay: 0.9, ease: "easeInOut" }}
          />
        </div>
        <div className="mt-2.5 flex gap-4 font-mono text-[11px] text-sub">
          <span>1,284 files</span>
          <span>·</span>
          <span>6 modules</span>
          <span>·</span>
          <span>14 yrs of history</span>
        </div>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Map
// ─────────────────────────────────────────────────────────────────────────────

const FILES = [
  { name: "interest.cbl", depth: 1, active: true },
  { name: "fees.cbl", depth: 1, active: true },
  { name: "ledger.cbl", depth: 1, active: false },
  { name: "dates.cbl", depth: 1, active: false },
];

const FOUND = [
  { fn: "INTEREST-CALC", file: "interest.cbl", tag: "business rule" },
  { fn: "APPLY-LATE-FEE", file: "fees.cbl", tag: "money" },
  { fn: "POST-LEDGER", file: "ledger.cbl", tag: "high fan-in" },
];

function MapStage() {
  return (
    <div className="grid h-full grid-cols-5 gap-4">
      {/* File tree */}
      <motion.div
        {...fade(0)}
        className="col-span-2 rounded-xl border border-ink/8 bg-ink/[0.02] p-3"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-sub">
          <FolderGit2 className="h-3.5 w-3.5" />
          src/
        </div>
        <div className="space-y-1">
          {FILES.map((f, i) => (
            <motion.div
              key={f.name}
              {...fade(0.15 + i * 0.1)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] ${
                f.active
                  ? "bg-[#7C3AED]/10 text-[#7C3AED]"
                  : "text-ink/55"
              }`}
            >
              <FileCode2 className="h-3 w-3 shrink-0" />
              {f.name}
              {f.active && (
                <span className="ml-auto text-[9px] font-semibold">migrate</span>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Found functions */}
      <div className="col-span-3 flex flex-col">
        <motion.div {...fade(0.2)} className="mb-2.5 flex gap-2">
          {[
            { v: "412", l: "functions" },
            { v: "38", l: "rules" },
            { v: "12", l: "to migrate", accent: true },
          ].map((s) => (
            <div
              key={s.l}
              className={`flex-1 rounded-lg border px-2.5 py-2 ${
                s.accent
                  ? "border-[#7C3AED]/25 bg-[#7C3AED]/[0.06]"
                  : "border-ink/8 bg-surface"
              }`}
            >
              <div
                className={`text-base font-bold ${
                  s.accent ? "text-[#7C3AED]" : "text-ink"
                }`}
              >
                {s.v}
              </div>
              <div className="text-[10px] text-sub">{s.l}</div>
            </div>
          ))}
        </motion.div>

        <div className="space-y-1.5">
          {FOUND.map((row, i) => (
            <motion.div
              key={row.fn}
              {...fade(0.45 + i * 0.12)}
              className="flex items-center gap-2 rounded-lg border border-ink/8 bg-surface px-3 py-2"
            >
              <span className="font-mono text-xs font-medium text-ink">
                {row.fn}
              </span>
              <span className="font-mono text-[10px] text-sub">
                {row.file}
              </span>
              <span className="ml-auto rounded-full bg-ink/[0.05] px-2 py-0.5 text-[10px] text-sub">
                {row.tag}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — Dependencies
// ─────────────────────────────────────────────────────────────────────────────

const NODES = [
  { id: "INTEREST", x: 84, y: 52, label: "INTEREST-CALC" },
  { id: "FEE", x: 84, y: 148, label: "APPLY-LATE-FEE" },
  { id: "LEDGER", x: 242, y: 62, label: "POST-LEDGER", hub: true },
  { id: "RATE", x: 240, y: 150, label: "GET-RATE" },
  { id: "AUDIT", x: 402, y: 72, label: "AUDIT-LOG" },
  { id: "DATE", x: 402, y: 150, label: "FORMAT-DATE" },
];

const EDGES: [string, string][] = [
  ["INTEREST", "LEDGER"],
  ["FEE", "LEDGER"],
  ["RATE", "LEDGER"],
  ["INTEREST", "RATE"],
  ["LEDGER", "AUDIT"],
  ["RATE", "DATE"],
];

function nodeById(id: string) {
  return NODES.find((n) => n.id === id)!;
}

function DepsStage() {
  return (
    <div className="flex h-full flex-col">
      <motion.div {...fade(0)} className="mb-1 text-xs font-medium text-sub">
        Call graph · who depends on whom
      </motion.div>
      <div className="min-h-0 flex-1">
        <svg
          viewBox="0 0 480 200"
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
        >
          {EDGES.map(([from, to], i) => {
            const a = nodeById(from);
            const b = nodeById(to);
            return (
              <motion.line
                key={`${from}-${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="stroke-ink"
                strokeWidth={1.2}
                initial={{ opacity: 0, pathLength: 0 }}
                animate={{ opacity: 0.16, pathLength: 1 }}
                transition={{ duration: 0.5, delay: 0.2 + i * 0.08 }}
              />
            );
          })}
          {NODES.map((n, i) => {
            const w = n.label.length * 6.2 + 16;
            return (
              <motion.g
                key={n.id}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, delay: 0.1 + i * 0.07 }}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
              >
                {n.hub && (
                  <motion.rect
                    x={n.x - w / 2 - 4}
                    y={n.y - 15}
                    width={w + 8}
                    height={30}
                    rx={9}
                    fill="none"
                    className="stroke-[#7C3AED]"
                    strokeWidth={1.5}
                    animate={{ opacity: [0.6, 0.15, 0.6] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  />
                )}
                <rect
                  x={n.x - w / 2}
                  y={n.y - 11}
                  width={w}
                  height={22}
                  rx={7}
                  className={
                    n.hub
                      ? "fill-[#7C3AED] stroke-[#7C3AED]"
                      : "fill-surface stroke-ink"
                  }
                  strokeOpacity={n.hub ? 1 : 0.18}
                  strokeWidth={1}
                />
                <text
                  x={n.x}
                  y={n.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="9"
                  fontFamily="ui-monospace, monospace"
                  fontWeight={600}
                  className={n.hub ? "fill-white" : "fill-ink"}
                >
                  {n.label}
                </text>
              </motion.g>
            );
          })}
        </svg>
      </div>
      <motion.div
        {...fade(1)}
        className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-[#7C3AED]/20 bg-[#7C3AED]/[0.06] px-2.5 py-1.5"
      >
        <Network className="h-3 w-3 text-[#7C3AED]" />
        <span className="text-[11px] text-ink">
          <span className="font-semibold">POST-LEDGER</span> · 14 callers ·
          highest fan-in · migrate last
        </span>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4 — Risk
// ─────────────────────────────────────────────────────────────────────────────

const RISK_ROWS: {
  fn: string;
  level: RiskLevel;
  reason: string;
}[] = [
  { fn: "APPLY-LATE-FEE", level: "critical", reason: "touches money · 14 callers" },
  { fn: "INTEREST-CALC", level: "high", reason: "money keyword · core rule" },
  { fn: "GET-RATE", level: "medium", reason: "reads external config" },
  { fn: "FORMAT-DATE", level: "low", reason: "pure · no side effects" },
];

function RiskStage() {
  return (
    <div className="flex h-full flex-col">
      <motion.div {...fade(0)} className="mb-2.5 text-xs font-medium text-sub">
        Risk-scored migration plan · deterministic, auditable
      </motion.div>
      <div className="flex flex-1 flex-col justify-center gap-2">
        {RISK_ROWS.map((row, i) => (
          <motion.div
            key={row.fn}
            {...fade(0.15 + i * 0.12)}
            className="flex items-center gap-3 rounded-xl border border-ink/8 bg-surface px-3.5 py-2.5"
            style={{ borderLeft: `3px solid ${RISK[row.level].color}` }}
          >
            <span className="font-mono text-xs font-medium text-ink">
              {row.fn}
            </span>
            <span className="font-mono text-[11px] text-sub">
              {row.reason}
            </span>
            <span className="ml-auto">
              <RiskTag level={row.level} />
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 5 & 6 — Migrate / Approve (share the diff)
// ─────────────────────────────────────────────────────────────────────────────

const COBOL = [
  "COMPUTE WS-INT =",
  "  WS-PRIN * WS-RATE / 100.",
  "IF WS-INT > WS-MAX",
  "   MOVE WS-MAX TO WS-INT.",
];

const PYTHON = [
  "interest = (Decimal(principal)",
  "  * Decimal(rate) / 100)",
  "interest = min(",
  "  interest, MAX_INTEREST)",
];

function DiffView({ generating }: { generating: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Legacy */}
      <div className="rounded-xl border border-ink/8 bg-ink/[0.03] p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-sub">
          <span className="h-1.5 w-1.5 rounded-full bg-sub" />
          COBOL · legacy
        </div>
        <pre className="space-y-0.5 font-mono text-[10.5px] leading-relaxed text-ink/55">
          {COBOL.map((l, i) => (
            <div key={i} className="whitespace-pre">
              {l}
            </div>
          ))}
        </pre>
      </div>

      {/* Modern */}
      <div className="rounded-xl border border-[#7C3AED]/20 bg-[#7C3AED]/[0.04] p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-[#7C3AED]">
          <Sparkles className="h-3 w-3" />
          Python 3.12
        </div>
        <pre className="space-y-0.5 font-mono text-[10.5px] leading-relaxed text-ink">
          {PYTHON.map((l, i) => (
            <motion.div
              key={i}
              className="whitespace-pre"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.25, duration: 0.3 }}
            >
              {l}
            </motion.div>
          ))}
          {generating && (
            <motion.span
              className="inline-block h-3 w-1.5 bg-[#7C3AED]"
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          )}
        </pre>
      </div>
    </div>
  );
}

function MigrateStage() {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <motion.div
        {...fade(0)}
        className="flex items-center justify-between"
      >
        <span className="text-xs font-medium text-ink">
          Migrating <span className="font-mono">INTEREST-CALC</span>
        </span>
        <span className="rounded-full bg-ink/[0.05] px-2 py-0.5 font-mono text-[10px] text-sub">
          chunk 1 of 12
        </span>
      </motion.div>

      <motion.div {...fade(0.15)}>
        <DiffView generating />
      </motion.div>

      <motion.div
        {...fade(1.4)}
        className="flex items-center gap-2 font-mono text-[11px] text-sub"
      >
        <span className="flex items-center gap-1 text-[#10B981]">
          <Check className="h-3 w-3" /> 3 tests generated from confirmed rule
        </span>
      </motion.div>
    </div>
  );
}

function ApproveStage() {
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setApproved(true), 1600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <motion.div {...fade(0)}>
        <DiffView generating={false} />
      </motion.div>

      <motion.div {...fade(0.3)} className="flex items-center gap-2">
        <motion.button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold text-white"
          animate={{
            background: approved ? "#10B981" : "#7C3AED",
            boxShadow: approved
              ? "0 0 0 4px rgba(16,185,129,0.15)"
              : "0 0 0 0px rgba(124,58,237,0)",
          }}
          transition={{ duration: 0.35 }}
        >
          {approved ? (
            <>
              <Check className="h-3.5 w-3.5" /> Approved
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" /> Approve
            </>
          )}
        </motion.button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink/12 bg-surface py-2.5 text-xs font-semibold text-sub">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-ink/12 bg-surface py-2.5 text-xs font-semibold text-sub">
          <X className="h-3.5 w-3.5" /> Reject
        </button>
      </motion.div>

      <AnimatePresence>
        {approved && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center gap-1.5 font-mono text-[11px] text-[#10B981]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Chunk 1/12 merged · next: APPLY-LATE-FEE
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage router
// ─────────────────────────────────────────────────────────────────────────────

function StageBody({ id }: { id: StageId }) {
  switch (id) {
    case "connect":
      return <ConnectStage />;
    case "map":
      return <MapStage />;
    case "deps":
      return <DepsStage />;
    case "risk":
      return <RiskStage />;
    case "migrate":
      return <MigrateStage />;
    case "approve":
      return <ApproveStage />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main window
// ─────────────────────────────────────────────────────────────────────────────

export function ProductDemo() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const stage = STAGES[active];

  // Auto-advance unless paused by manual navigation.
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(
      () => setActive((a) => (a + 1) % STAGES.length),
      DURATION[stage.id],
    );
    return () => clearTimeout(t);
  }, [active, stage.id, paused]);

  // Resume autoplay a while after the last manual interaction.
  useEffect(() => {
    if (!paused) return;
    const t = setTimeout(() => setPaused(false), 12000);
    return () => clearTimeout(t);
  }, [paused, active]);

  const goTo = (i: number) => {
    setActive(i);
    setPaused(true);
  };

  return (
    <section className="px-6 py-12 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="glass-strong overflow-hidden rounded-2xl"
        >
          {/* Window chrome */}
          <div className="flex items-center gap-3 border-b border-ink/8 px-4 py-3">
            <div className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
              <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
              <span className="h-3 w-3 rounded-full bg-[#28C840]" />
            </div>
            <div className="mx-auto flex items-center gap-1.5 rounded-md bg-ink/[0.04] px-3 py-1">
              <Lock className="h-3 w-3 text-sub" />
              <span className="font-mono text-[11px] text-sub">
                app.legacylift.dev/acme-bank/loan-engine
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? "Play demo" : "Pause demo"}
                className="flex h-6 w-6 items-center justify-center rounded-full text-sub transition-colors hover:bg-ink/[0.06] hover:text-ink"
              >
                {paused ? (
                  <Play className="h-3 w-3" />
                ) : (
                  <Pause className="h-3 w-3" />
                )}
              </button>
              <div className="flex items-center gap-1.5">
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-[#10B981]"
                  animate={{ opacity: paused ? 1 : [1, 0.3, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                />
                <span className="text-[10px] font-medium text-sub">
                  {paused ? "Paused" : "Live"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row">
            {/* Stepper rail */}
            <div className="shrink-0 border-b border-ink/8 px-3 py-3 md:w-52 md:border-b-0 md:border-r md:py-5">
              <div className="flex gap-2 overflow-x-auto md:flex-col md:gap-1 md:overflow-visible">
                {STAGES.map((s, i) => {
                  const isActive = i === active;
                  const isDone = i < active;
                  return (
                    <button
                      key={s.id}
                      onClick={() => goTo(i)}
                      aria-label={`Go to ${s.label}`}
                      className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors md:w-full ${
                        isActive
                          ? "bg-[#7C3AED]/[0.08]"
                          : "hover:bg-ink/[0.05]"
                      }`}
                    >
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                          isActive
                            ? "bg-[#7C3AED] text-white"
                            : isDone
                              ? "bg-[#10B981] text-white"
                              : "bg-ink/10 text-ink/40"
                        }`}
                      >
                        {isDone ? <Check className="h-3 w-3" /> : i + 1}
                      </div>
                      <div className="hidden md:block">
                        <div
                          className={`text-xs font-semibold leading-tight ${
                            isActive ? "text-[#7C3AED]" : "text-ink"
                          }`}
                        >
                          {s.label}
                        </div>
                        <div className="text-[10px] text-sub">{s.hint}</div>
                      </div>
                      <span
                        className={`text-xs font-medium md:hidden ${
                          isActive ? "text-[#7C3AED]" : "text-sub"
                        }`}
                      >
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main panel */}
            <div className="relative flex-1">
              <div className="h-[340px] p-5 sm:h-[360px] sm:p-6">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={stage.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full"
                  >
                    <StageBody id={stage.id} />
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Auto-progress bar */}
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink/5">
                <motion.div
                  key={`${active}-${paused}`}
                  className="h-full bg-[#7C3AED]"
                  initial={{ width: paused ? "100%" : "0%" }}
                  animate={{ width: "100%" }}
                  transition={{
                    duration: paused ? 0 : DURATION[stage.id] / 1000,
                    ease: "linear",
                  }}
                />
              </div>
            </div>
          </div>
        </motion.div>

        <p className="mt-4 text-center text-xs text-sub">
          A real run on a COBOL loan engine — paste a repo and watch the same flow.
        </p>
      </div>
    </section>
  );
}
