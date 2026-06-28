"use client";
// Navbar — Top navigation bar shown on all pages.
// Shows the LegacyLift logo, page title (if provided), and an optional
// WebSocketStatus indicator when a project is active.
//
// TODO: Add auth state (login/logout) once JWT auth is wired up.

import Link from "next/link";
import { Cpu } from "lucide-react";
import { WebSocketStatus } from "@/components/shared/WebSocketStatus";
import type { ConnectionStatus } from "@/types/legacylift";

interface NavbarProps {
  wsStatus?: ConnectionStatus;
  projectId?: string;
}

export function Navbar({ wsStatus, projectId }: NavbarProps) {
  return (
    <nav className="sticky top-0 z-50 border-b border-[#222222] bg-[#0a0a0a]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-white hover:opacity-80 transition-opacity">
          <Cpu className="h-5 w-5 text-[#2563EB]" />
          <span className="font-semibold tracking-tight">LegacyLift</span>
        </Link>

        {/* Right section */}
        <div className="flex items-center gap-4">
          {projectId && wsStatus && (
            <WebSocketStatus status={wsStatus} />
          )}
          <Link
            href="/demo"
            className="rounded-md bg-[#2563EB] px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            New Migration
          </Link>
        </div>
      </div>
    </nav>
  );
}
