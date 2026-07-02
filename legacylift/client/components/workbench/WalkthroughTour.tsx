"use client";
// WalkthroughTour — a friendly, app-onboarding style guided tour for the
// migration workbench. It spotlights real elements on the page (found by their
// `data-tour="..."` attribute), pops a plain-language explanation next to each,
// and walks a first-time (or non-technical) user through both the Overview and
// Review tabs. Switching tabs is handled for the user as the tour advances.
//
// Add a step by pushing to STEPS and tagging the target element with a matching
// `data-tour` attribute. Steps with no `target` render centered (welcome/finish).

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lightbulb,
  X,
  ArrowLeft,
  ArrowRight,
  Check,
} from "lucide-react";
import type { WorkbenchView } from "@/components/workbench/WorkbenchHeader";

interface TourStep {
  /** The `data-tour` value of the element to spotlight. Omit for a centered card. */
  target?: string;
  /** Which tab this step lives on — the tour switches to it automatically. */
  view?: WorkbenchView;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    title: "Welcome to LegacyLift 👋",
    body: "This dashboard turns your old COBOL system into modern, tested Python — with a real person approving every change. Here's a quick tour of how it all works.",
  },
  {
    target: "tab-overview",
    view: "overview",
    title: "Two simple views",
    body: "Everything lives under two tabs. Overview is the big-picture map of your codebase. Review is where you check the new code. We're on Overview right now.",
  },
  {
    target: "stats",
    view: "overview",
    title: "The headline numbers",
    body: "At a glance: how many functions we found, the business rules we pulled out, the overall risk, and how many pieces have been approved so far.",
  },
  {
    target: "files",
    view: "overview",
    title: "Your files",
    body: "Each old file becomes modern code here. When you're happy with a file, you 'Finalize' it. The counter on the right tracks how many are done.",
  },
  {
    target: "risk",
    view: "overview",
    title: "Risk at a glance",
    body: "Some code is trickier than others. This bar shows how much is low, medium, high or critical risk — so you know where to look most carefully.",
  },
  {
    target: "graph",
    view: "overview",
    title: "How it all connects",
    body: "This map shows how the pieces of your system depend on one another — handy for understanding the knock-on effects of a change.",
  },
  {
    target: "rules",
    view: "overview",
    title: "The business rules we found",
    body: "These are the important real-world rules hidden in your old code — things like fees or eligibility checks. We carry them into the new code, unchanged.",
  },
  {
    target: "tab-review",
    view: "review",
    title: "Now the Review tab",
    body: "This is where the real checking happens. You go through the new code one piece at a time — just like reviewing changes before they go live.",
  },
  {
    target: "queue",
    view: "review",
    title: "The to-do list",
    body: "Every piece waiting for your review is listed here, grouped by file. Click any item to open it — and you can search or filter to find things fast.",
  },
  {
    target: "review-main",
    view: "review",
    title: "Old vs. new, side by side",
    body: "See the original code next to the new version, plus the automatic checks that ran. When it looks right, Approve it. If not, ask the AI to fix it or request changes.",
  },
  {
    target: "context",
    view: "review",
    title: "See the full picture",
    body: "This panel shows where the current piece sits inside the original file, so you always have the surrounding context while you review.",
  },
  {
    target: "progress",
    view: "review",
    title: "Track your progress",
    body: "This bar fills up as you approve pieces. Once every file is finalized and reviewed, the Download button hands you the finished, modern project.",
  },
  {
    target: "help",
    title: "That's it! 🎉",
    body: "You're ready to go. Click this lightbulb any time to replay the tour. Happy migrating!",
  },
];

const PAD = 8; // breathing room around the spotlighted element
const GAP = 14; // distance between the spotlight and the tooltip card
const CARD_W = 344;
const MARGIN = 12; // min gap the card keeps from every viewport edge

interface Spotlight {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface WalkthroughTourProps {
  open: boolean;
  onClose: () => void;
  view: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
}

export function WalkthroughTour({
  open,
  onClose,
  view,
  onViewChange,
}: WalkthroughTourProps) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Spotlight | null>(null);
  const [cardStyle, setCardStyle] = useState<React.CSSProperties>({});
  const [centered, setCentered] = useState(true);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const step = STEPS[index];
  const isFirst = index === 0;
  const isLast = index === STEPS.length - 1;

  // Reset to the first step every time the tour is opened.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Measure the current target and place the spotlight + tooltip. Re-run on
  // scroll/resize so the spotlight "travels" with the element.
  const measure = useCallback(() => {
    const sel = step.target;
    if (!sel) {
      setSpot(null);
      setCentered(true);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${sel}"]`);
    const rect = el?.getBoundingClientRect();
    if (!el || !rect || (rect.width === 0 && rect.height === 0)) {
      // Target isn't on screen (e.g. hidden on a narrow layout) — fall back to
      // a centered card so the explanation still shows.
      setSpot(null);
      setCentered(true);
      return;
    }

    setCentered(false);
    setSpot({
      top: rect.top - PAD,
      left: rect.left - PAD,
      width: rect.width + PAD * 2,
      height: rect.height + PAD * 2,
    });

    // Place the card just outside the target, then guarantee it stays fully
    // on-screen. Tall targets (a full-height sidebar, the review pane) have no
    // room above/below, so we fall back to the side with the most space and
    // always clamp the final position inside the viewport.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(CARD_W, vw - MARGIN * 2);
    const cardH = Math.min(cardRef.current?.offsetHeight ?? 240, vh - MARGIN * 2);
    const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - cardW - MARGIN));
    const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - cardH - MARGIN));
    const midX = rect.left + rect.width / 2 - cardW / 2;
    const midY = rect.top + rect.height / 2 - cardH / 2;

    const fitsBelow = rect.bottom + GAP + cardH + MARGIN <= vh;
    const fitsAbove = rect.top - GAP - cardH - MARGIN >= 0;
    const fitsRight = rect.right + GAP + cardW + MARGIN <= vw;
    const fitsLeft = rect.left - GAP - cardW - MARGIN >= 0;

    let top: number;
    let left: number;
    if (fitsBelow) {
      top = rect.bottom + GAP;
      left = clampX(midX);
    } else if (fitsAbove) {
      top = rect.top - GAP - cardH;
      left = clampX(midX);
    } else if (fitsRight) {
      left = rect.right + GAP;
      top = clampY(midY);
    } else if (fitsLeft) {
      left = rect.left - GAP - cardW;
      top = clampY(midY);
    } else {
      // Target is bigger than the viewport in both axes — tuck the card into
      // whichever side has more room so it covers as little as possible.
      left = vw - rect.right >= rect.left ? clampX(vw - cardW - MARGIN) : clampX(MARGIN);
      top = clampY(midY);
    }

    setCardStyle({ top, left, width: cardW });
  }, [step.target]);

  // On step change: switch tabs if needed, then wait for the target to mount
  // (a tab switch re-renders its panel) before scrolling it into view.
  useEffect(() => {
    if (!open) return;
    if (step.view && step.view !== view) {
      onViewChange(step.view);
    }

    let raf = 0;
    let tries = 0;
    // The card fades in via AnimatePresence, so its real height isn't known for
    // a few frames — re-measure a couple of times so its final position (which
    // depends on that height) is correct.
    const timers = [
      window.setTimeout(measure, 220),
      window.setTimeout(measure, 400),
    ];
    const attempt = () => {
      if (!step.target) {
        measure();
        return;
      }
      // Wait until we're on the right tab AND the element exists.
      const onRightView = !step.view || step.view === view;
      const el = onRightView
        ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
        : null;
      const rect = el?.getBoundingClientRect();
      const ready = !!rect && (rect.width > 0 || rect.height > 0);

      if (ready) {
        el!.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        measure();
      } else if (tries < 40) {
        tries += 1;
        raf = requestAnimationFrame(attempt);
      } else {
        measure(); // give up gracefully → centered fallback
      }
    };
    attempt();
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [index, open, view, step.view, step.target, onViewChange, measure]);

  // Keep the spotlight glued to its element while the page scrolls/resizes.
  useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, measure]);

  const next = useCallback(() => {
    setIndex((i) => (i >= STEPS.length - 1 ? i : i + 1));
  }, []);
  const back = useCallback(() => {
    setIndex((i) => (i <= 0 ? i : i - 1));
  }, []);

  // Keyboard: arrows to navigate, Escape to leave.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, next, back]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Click-catcher: blocks interaction with the page behind the tour.
          When there's a spotlight, the dimming comes from its box-shadow, so
          this layer stays transparent; on centered steps it dims everything. */}
      <div
        className={`absolute inset-0 transition-colors ${
          centered ? "bg-black/60" : "bg-transparent"
        }`}
      />

      {/* Spotlight ring around the highlighted element. */}
      {!centered && spot && (
        <div
          className="pointer-events-none absolute rounded-xl outline outline-2 outline-[#7C3AED] outline-offset-4 transition-all duration-300 ease-out"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
          }}
        />
      )}

      {/* Tooltip card. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          ref={cardRef}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          className={`pointer-events-auto absolute w-[344px] max-w-[calc(100vw-2rem)] rounded-2xl border border-ink/10 bg-base p-5 shadow-2xl ${
            centered ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" : ""
          }`}
          style={centered ? undefined : cardStyle}
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#7C3AED]/12 text-[#7C3AED]">
              <Lightbulb className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold leading-tight text-ink">
                {step.title}
              </h3>
            </div>
            <button
              onClick={onClose}
              aria-label="Close tour"
              className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sub transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-sub">{step.body}</p>

          {/* Progress dots */}
          <div className="mt-4 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`Go to step ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index
                    ? "w-5 bg-[#7C3AED]"
                    : "w-1.5 bg-ink/15 hover:bg-ink/30"
                }`}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              onClick={onClose}
              className="text-xs font-medium text-sub transition-colors hover:text-ink"
            >
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              {!isFirst && (
                <button
                  onClick={back}
                  className="inline-flex items-center gap-1 rounded-lg border border-ink/12 px-3 py-1.5 text-sm font-medium text-ink/80 transition-colors hover:bg-ink/[0.06]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              )}
              <button
                onClick={isLast ? onClose : next}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#7C3AED] px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9]"
              >
                {isLast ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Got it
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {!isLast && (
            <div className="mt-3 text-center text-[11px] text-sub/70">
              Step {index + 1} of {STEPS.length}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
