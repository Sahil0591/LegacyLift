"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Cpu,
  Plus,
  ArrowRight,
  Trash2,
  GitBranch,
  Upload,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Navbar } from "@/components/shared/Navbar";
import { AmbientBackground } from "@/components/landing/AmbientBackground";
import type { ProjectIndexEntry } from "@/lib/projectStore";
import {
  deleteServerProject,
  getUserLimits,
  listServerProjects,
  type ServerProject,
  type UserLimits,
} from "@/lib/api";

// The dashboard is DB-backed only: every card comes from /projects (owner-scoped
// by the Clerk user), so the list is identical on every device the user signs
// in on. localStorage projects are intentionally not merged in here - they can't
// sync across devices, which is exactly the mismatch we want to avoid.
type DashboardProject = ProjectIndexEntry;

function statusFromServer(status: string): ProjectIndexEntry["status"] {
  const normalized = status.toLowerCase();
  if (normalized === "complete") return "complete";
  if (["analysing", "migrating", "validating", "failed"].includes(normalized)) {
    return "in_progress";
  }
  return "ready";
}

function projectFromServer(project: ServerProject): DashboardProject {
  return {
    id: project.project_id,
    name: project.name,
    source: project.source ?? "server",
    language: project.source_language,
    chunksTotal: project.chunk_count,
    chunksApproved: project.chunks_approved,
    status: statusFromServer(project.status),
    createdAt: project.created_at,
    updatedAt: project.completed_at ?? project.created_at,
  };
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ProjectIndexEntry["status"] }) {
  const cfg = {
    ready: {
      icon: Clock,
      label: "Ready",
      className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    },
    in_progress: {
      icon: Loader2,
      label: "In progress",
      className: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    },
    complete: {
      icon: CheckCircle2,
      label: "Complete",
      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    },
  }[status];

  const Icon = cfg.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.className}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Source label
// ---------------------------------------------------------------------------

function SourceLabel({ source }: { source: string }) {
  const isGitHub = source.startsWith("github:");
  const Icon = isGitHub ? GitBranch : Upload;
  const label = isGitHub
    ? source.replace("github:", "")
    : "Uploaded files";

  return (
    <span className="flex min-w-0 max-w-full items-center gap-1 font-mono text-xs text-sub">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  onDelete,
}: {
  project: DashboardProject;
  onDelete: (id: string) => void;
}) {
  const progress =
    project.chunksTotal > 0
      ? (project.chunksApproved / project.chunksTotal) * 100
      : 0;

  const createdDate = new Date(project.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative flex min-w-0 flex-col gap-3 rounded-2xl border border-ink/10 bg-surface/40 p-5 backdrop-blur transition-colors hover:border-[#7C3AED]/30 hover:bg-surface/60"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-ink">{project.name}</h3>
          <SourceLabel source={project.source} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={project.status} />
          <button
            onClick={() => onDelete(project.id)}
            title="Delete project"
            className="rounded-lg p-1.5 text-sub opacity-0 transition-all hover:bg-ink/10 hover:text-red-400 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Language pill */}
      <span className="self-start rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[11px] font-medium text-sub">
        {project.language} → Python
      </span>

      {/* Progress */}
      {project.chunksTotal > 0 && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full rounded-full bg-[#10B981] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs text-sub">
            {project.chunksApproved}/{project.chunksTotal}
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-sub/70">{createdDate}</span>
        <Link
          href={`/project/${project.id}`}
          className="inline-flex items-center gap-1 rounded-lg bg-[#7C3AED] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#6D28D9]"
        >
          Resume
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Limits bar
// ---------------------------------------------------------------------------

function LimitsBar({ limits }: { limits: UserLimits }) {
  const pct = Math.round((limits.projects_used / limits.max_projects) * 100);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink/10 bg-surface/40 px-4 py-3 backdrop-blur">
      <div className="flex-1">
        <div className="mb-1 flex justify-between text-xs text-sub">
          <span>Projects used</span>
          <span>
            {limits.projects_used}/{limits.max_projects}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-[#7C3AED] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold text-ink">
          {limits.migrations_remaining}
        </div>
        <div className="text-[11px] text-sub">AI runs left today</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-ink/10 bg-surface/40">
        <Cpu className="h-7 w-7 text-sub" />
      </div>
      <div>
        <h2 className="font-semibold text-ink">No migrations yet</h2>
        <p className="mt-1 text-sm text-sub">
          Start your first migration to see it here.
        </p>
      </div>
      <Link
        href="/demo"
        className="inline-flex items-center gap-2 rounded-xl bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-colors hover:bg-[#6D28D9]"
      >
        <Plus className="h-4 w-4" />
        Start a migration
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [limits, setLimits] = useState<UserLimits | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      const [serverProjects, userLimits] = await Promise.all([
        listServerProjects(),
        getUserLimits(),
      ]);
      if (cancelled) return;

      setProjects(serverProjects.map(projectFromServer));
      setLimits(userLimits);
    }

    loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    // Optimistic removal; delete server-side and free a quota slot.
    setProjects((prev) => prev.filter((p) => p.id !== id));
    try {
      await deleteServerProject(id);
      setLimits((prev) =>
        prev
          ? {
              ...prev,
              projects_used: Math.max(0, prev.projects_used - 1),
              projects_remaining: prev.projects_remaining + 1,
            }
          : prev,
      );
    } catch {
      // Re-add on failure so the card isn't silently lost.
      setProjects((prev) =>
        prev.some((p) => p.id === id) ? prev : [project, ...prev],
      );
    }
  };

  return (
    <div className="relative min-h-screen bg-base text-ink">
      <AmbientBackground />
      <div className="relative z-10">
        <Navbar />
        <main className="mx-auto max-w-3xl px-6 py-12">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-ink">
                Your migrations
              </h1>
              <p className="mt-1 text-sm text-sub">
                Pick up where you left off, or start something new.
              </p>
            </div>
            <Link
              href="/demo"
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-colors hover:bg-[#6D28D9]"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New migration</span>
              <span className="sm:hidden">New</span>
            </Link>
          </div>

          {/* Limits bar (only when backend is available) */}
          {limits && (
            <div className="mb-6">
              <LimitsBar limits={limits} />
            </div>
          )}

          {/* Projects grid */}
          {projects.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
