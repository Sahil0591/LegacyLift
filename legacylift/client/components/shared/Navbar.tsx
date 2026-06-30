"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Cpu } from "lucide-react";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";
import { WebSocketStatus } from "@/components/shared/WebSocketStatus";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import type { ConnectionStatus } from "@/types/legacylift";

interface NavbarProps {
  wsStatus?: ConnectionStatus;
  projectId?: string;
}

export function Navbar({ wsStatus, projectId }: NavbarProps) {
  const { isSignedIn } = useUser();
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
        >
          <Cpu className="h-5 w-5 text-[#7C3AED]" />
          <span className="font-semibold tracking-tight">LegacyLift</span>
        </Link>

        <div className="flex items-center gap-3">
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
          {isSignedIn ? (
            <UserButton />
          ) : (
            <SignInButton mode="redirect">
              <button className="rounded-full border border-ink/20 px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ink/[0.06]">
                Sign in
              </button>
            </SignInButton>
          )}
        </div>
      </div>
    </motion.nav>
  );
}
