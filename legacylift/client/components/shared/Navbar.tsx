"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Menu, X } from "lucide-react";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { WebSocketStatus } from "@/components/shared/WebSocketStatus";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { clerkEnabled } from "@/lib/authMode";
import type { ConnectionStatus } from "@/types/legacylift";

interface NavbarProps {
  wsStatus?: ConnectionStatus;
  projectId?: string;
}

export function Navbar({ wsStatus, projectId }: NavbarProps) {
  if (clerkEnabled) return <NavbarWithClerk wsStatus={wsStatus} projectId={projectId} />;
  return (
    <NavbarChrome
      wsStatus={wsStatus}
      projectId={projectId}
      isSignedIn={false}
      showAuthControls={false}
    />
  );
}

function NavbarWithClerk({ wsStatus, projectId }: NavbarProps) {
  const { isSignedIn } = useUser();
  return (
    <NavbarChrome
      wsStatus={wsStatus}
      projectId={projectId}
      isSignedIn={!!isSignedIn}
      showAuthControls
    />
  );
}

interface NavbarChromeProps extends NavbarProps {
  isSignedIn: boolean;
  showAuthControls: boolean;
}

function NavbarChrome({
  wsStatus,
  projectId,
  isSignedIn,
  showAuthControls,
}: NavbarChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <motion.nav
      className="sticky top-0 z-50 border-b border-ink/10 bg-base/70 backdrop-blur-2xl"
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-ink transition-opacity hover:opacity-75"
          onClick={() => setMenuOpen(false)}
        >
          <Cpu className="h-5 w-5 text-[#7C3AED]" />
          <span className="font-semibold tracking-tight">LegacyLift</span>
        </Link>

        {/* Desktop / tablet nav */}
        <div className="hidden items-center gap-3 sm:flex">
          {projectId && wsStatus && <WebSocketStatus status={wsStatus} />}
          <ThemeToggle />
          {isSignedIn && (
            <Link
              href="/projects"
              className="rounded-full border border-ink/20 px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ink/[0.06]"
            >
              My Projects
            </Link>
          )}
          <Link
            href="/demo"
            className="rounded-full bg-[#7C3AED] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#6D28D9]"
          >
            New Migration
          </Link>
          {showAuthControls && isSignedIn ? (
            <UserButton />
          ) : showAuthControls ? (
            <SignInButton mode="redirect">
              <button className="rounded-full border border-ink/20 px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ink/[0.06]">
                Sign in
              </button>
            </SignInButton>
          ) : null}
        </div>

        {/* Mobile controls */}
        <div className="flex items-center gap-2 sm:hidden">
          {projectId && wsStatus && <WebSocketStatus status={wsStatus} />}
          <ThemeToggle />
          {showAuthControls && isSignedIn && <UserButton />}
          <button
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/10 text-ink/70 transition-colors hover:bg-ink/[0.06] hover:text-ink"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-ink/10 sm:hidden"
          >
            <div className="flex flex-col gap-2 px-6 py-3">
              {isSignedIn && (
                <Link
                  href="/projects"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl border border-ink/20 px-4 py-2 text-center text-sm font-medium text-ink transition-colors hover:bg-ink/[0.06]"
                >
                  My Projects
                </Link>
              )}
              <Link
                href="/demo"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl bg-[#7C3AED] px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-[#6D28D9]"
              >
                New Migration
              </Link>
              {showAuthControls && !isSignedIn && (
                <SignInButton mode="redirect">
                  <button
                    onClick={() => setMenuOpen(false)}
                    className="rounded-xl border border-ink/20 px-4 py-2 text-center text-sm font-medium text-ink transition-colors hover:bg-ink/[0.06]"
                  >
                    Sign in
                  </button>
                </SignInButton>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
