// Footer — light glass footer for the public landing page.

import Link from "next/link";
import { Cpu, Github } from "lucide-react";
import { DEMO_PROJECT_ID } from "@/lib/demoData";

export function Footer() {
  return (
    <footer className="border-t border-ink/8 bg-surface/40 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[#7C3AED]" />
          <span className="text-sm font-semibold text-ink">LegacyLift</span>
          <span className="text-sm text-sub">
            — Legacy code. Finally understood.
          </span>
        </div>

        <div className="flex items-center gap-5 text-sm text-sub">
          <a
            href="https://github.com/Sahil0591/LegacyLift"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-ink"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
          <Link
            href={`/project/${DEMO_PROJECT_ID}`}
            className="transition-colors hover:text-ink"
          >
            Try the demo
          </Link>
          <span className="text-[#7C3AED]">Conduct AI · 2026</span>
        </div>
      </div>
    </footer>
  );
}
