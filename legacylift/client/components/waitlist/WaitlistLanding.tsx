"use client";

// components/waitlist/WaitlistLanding.tsx - The public marketing + waitlist page.
// While the product is gated (see middleware.ts) this is the ONLY page served,
// so it doubles as the full pitch: hero + the real ProductDemo and WhyDifferent
// sections + a waitlist form. The form submits with a two-tier strategy: try the
// Formspree hosted form first, and if that fails (or isn't configured) fall back
// to POSTing /api/waitlist, which writes to Neon.

import { useState } from "react";
import { motion } from "framer-motion";
import { Cpu, ArrowRight, Loader2, Check } from "lucide-react";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { ProductDemo } from "@/components/landing/ProductDemo";
import { WhyDifferent } from "@/components/landing/WhyDifferent";
import { submitWaitlist } from "@/lib/api";

const EASE = [0.22, 1, 0.36, 1] as const;

// Formspree endpoint (https://formspree.io/f/xxxxxxxx). Optional: when unset the
// form goes straight to the Neon fallback route.
const ENDPOINT = process.env.NEXT_PUBLIC_FORMSPREE_ENDPOINT;

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistLanding() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [useCase, setUseCase] = useState("");
  // Honeypot: real users never fill this off-screen field; bots do.
  const [gotcha, setGotcha] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const submitting = status === "submitting";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (gotcha) {
      setStatus("success"); // bot: pretend it worked, send nothing
      return;
    }
    if (!email.trim()) {
      setError("Enter your email so we can reach you.");
      return;
    }

    setStatus("submitting");
    const record = {
      name: name.trim(),
      email: email.trim(),
      company: company.trim(),
      use_case: useCase.trim(),
    };

    // 1) Formspree first (if configured).
    if (ENDPOINT) {
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            ...record,
            _subject: `LegacyLift waitlist - ${record.email}`,
          }),
        });
        if (res.ok) {
          setStatus("success");
          return;
        }
      } catch {
        // fall through to the Neon fallback
      }
    }

    // 2) Fall back to our backend, which writes to the same DB the rest of the
    //    app uses - no separate DB config needed in any environment.
    try {
      await submitWaitlist(record);
      setStatus("success");
      return;
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(
        code === "invalid_email"
          ? "That email doesn't look right - please check it."
          : "Couldn't reach the server - please try again in a moment.",
      );
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Sticky top bar with an always-available CTA */}
      <header className="sticky top-0 z-50 border-b border-ink/10 bg-base/70 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 text-ink">
            <Cpu className="h-5 w-5 text-[#7C3AED]" />
            <span className="font-semibold tracking-tight">LegacyLift</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a
              href="#waitlist"
              className="hidden rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-base transition-opacity hover:opacity-90 sm:inline-flex"
            >
              Request access
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:py-20">
        {/* Left: positioning */}
        <div>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-sub"
          >
            The end-to-end legacy migration bench
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05, ease: EASE }}
            className="mt-5 text-4xl font-semibold leading-[1.06] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]"
          >
            Migrate legacy code
            <br />
            without losing <span className="text-[#7C3AED]">the why.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: EASE }}
            className="mt-6 max-w-lg text-base leading-relaxed text-sub"
          >
            A complete bench for converting COBOL, VB6, and legacy Java from end
            to end. LegacyLift extracts the business rules buried in your source,
            scores the risk, migrates unit by unit, generates the tests, and puts
            an engineer in front of every merge. No black-box rewrites, and
            nothing ships without review.
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.28 }}
            className="mt-7 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11px] text-sub"
          >
            {["Semantic code analysis", "Multi-model verification", "Test-backed migration"].map(
              (item, i, arr) => (
                <span key={item} className="flex items-center gap-4">
                  {item}
                  {i < arr.length - 1 && <span className="text-ink/20">/</span>}
                </span>
              ),
            )}
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.36 }}
            className="mt-6 text-sm leading-relaxed text-sub/80"
          >
            Started at the Imperial College London hackathon, now expanding into
            a production tool for engineering teams.
          </motion.p>
        </div>

        {/* Right: waitlist form (anchor target) */}
        <motion.div
          id="waitlist"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18, ease: EASE }}
          className="scroll-mt-24 rounded-2xl border border-ink/10 bg-surface/50 p-6 backdrop-blur-xl sm:p-8"
        >
          {status === "success" ? (
            <div className="flex flex-col items-start gap-4 py-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#7C3AED]/30 bg-[#7C3AED]/10">
                <Check className="h-5 w-5 text-[#7C3AED]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  You&rsquo;re on the list
                </h2>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-sub">
                  Thanks{name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}, we
                  saved your spot. We&rsquo;ll email{" "}
                  <span className="text-ink">{email.trim()}</span> the moment
                  early access opens.
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sub">
                Request access
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">
                Join the waitlist
              </h2>
              <p className="mt-1 text-sm text-sub">
                Under a minute. We&rsquo;ll reach out when your spot opens.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
                <Field label="Full name">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder="Ada Lovelace"
                    className={inputClass}
                  />
                </Field>

                <Field label="Work email" required>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="you@company.com"
                    className={inputClass}
                  />
                </Field>

                <Field label="Company / team">
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    autoComplete="organization"
                    placeholder="Acme Corp"
                    className={inputClass}
                  />
                </Field>

                <Field label="What are you looking to migrate?">
                  <textarea
                    value={useCase}
                    onChange={(e) => setUseCase(e.target.value)}
                    rows={3}
                    placeholder="e.g. a COBOL mainframe, a VB6 desktop app, legacy Java service..."
                    className={`${inputClass} resize-none`}
                  />
                </Field>

                {/* Honeypot - off-screen, not tab-focusable */}
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={gotcha}
                  onChange={(e) => setGotcha(e.target.value)}
                  className="absolute left-[-9999px] h-0 w-0 opacity-0"
                />

                {error && (
                  <p className="text-sm text-[#DC2626]" role="alert">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-6 py-3 text-sm font-semibold text-base transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Requesting...
                    </>
                  ) : (
                    <>
                      Request access
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>

                <p className="text-[11px] text-sub/70">
                  No spam. Early-access updates only.
                </p>
              </form>
            </>
          )}
        </motion.div>
      </section>

      {/* The real product, running end to end */}
      <ProductDemo />

      {/* Why it's different + stats */}
      <WhyDifferent />

      {/* Closing CTA - borrows the ROI hook, drives back to the form */}
      <section className="px-6 pb-24 pt-4">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mx-auto max-w-3xl rounded-2xl border border-ink/10 bg-surface/50 px-6 py-12 text-center backdrop-blur-xl sm:px-12"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sub">
            The honest math
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Six months of consultants, or{" "}
            <span className="text-[#7C3AED]">two weeks.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-sub">
            LegacyLift does the reading. You do the deciding. Request early
            access before your next migration.
          </p>
          <a
            href="#waitlist"
            className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-ink px-8 py-3 text-sm font-semibold text-base transition-opacity hover:opacity-90"
          >
            Join the waitlist
            <ArrowRight className="h-4 w-4" />
          </a>
        </motion.div>
      </section>

      <footer className="border-t border-ink/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 py-5 text-center font-mono text-[11px] text-sub sm:flex-row sm:justify-between sm:text-left">
          <span>&copy; 2026 LegacyLift</span>
          <span>Imperial College London</span>
        </div>
      </footer>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-ink/15 bg-base/40 px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-sub/50 focus:border-[#7C3AED]/60 focus:ring-1 focus:ring-[#7C3AED]/30";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-sub">
        {label}
        {required && <span className="ml-0.5 text-[#7C3AED]">*</span>}
      </span>
      {children}
    </label>
  );
}
