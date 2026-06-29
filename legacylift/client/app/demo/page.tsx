"use client";
// app/demo/page.tsx — Start a migration. Two ways in: paste a GitHub repo, or
// upload legacy source files. Both open the workbench at /project/[id].

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Github, ArrowRight, FolderUp, Lock } from "lucide-react";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { AmbientBackground } from "@/components/landing/AmbientBackground";
import { FileUpload } from "@/components/pipeline/FileUpload";
import { createProject, uploadFiles, startPipeline } from "@/lib/api";
import { DEMO_PROJECT_ID, DEMO_REPO } from "@/lib/demoData";
import type { ProjectLanguage } from "@/types/legacylift";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const LANGUAGES: ProjectLanguage[] = ["COBOL", "Java", "VB6"];

type Tab = "repo" | "files";

export default function DemoPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("repo");
  const [repoUrl, setRepoUrl] = useState(DEMO_REPO);
  const [repoLang, setRepoLang] = useState<ProjectLanguage>("COBOL");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goToDemo = () => router.push(`/project/${DEMO_PROJECT_ID}`);

  // No public backend yet — a pasted repo runs the seeded sample workbench.
  const handleRepoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    goToDemo();
  };

  const handleFileSubmit = async (
    files: File[],
    schema: File | null,
    language: ProjectLanguage,
  ) => {
    setLoading(true);
    setError(null);

    if (DEMO_MODE) {
      goToDemo();
      return;
    }

    try {
      const { project_id } = await createProject({ name: "Migration", language });
      await uploadFiles(project_id, files, schema ?? undefined);
      await startPipeline(project_id);
      router.push(`/project/${project_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-base text-ink">
      <AmbientBackground />
      <div className="relative z-10">
        <Navbar />
        <main className="mx-auto max-w-2xl px-6 py-16">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mb-8"
          >
            <h1 className="text-3xl font-bold tracking-tight text-ink">
              Start a migration
            </h1>
            <p className="mt-2 text-sm text-sub">
              Point LegacyLift at a legacy codebase. It maps every business rule
              and dependency, scores the risk, and migrates chunk by chunk — with
              you approving each step.
            </p>
          </motion.div>

          {/* Tabs */}
          <div className="mb-5 inline-flex rounded-xl border border-ink/10 bg-surface/50 p-1 backdrop-blur">
            {(
              [
                { id: "repo", label: "GitHub repo", Icon: Github },
                { id: "files", label: "Upload files", Icon: FolderUp },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === id
                    ? "bg-[#7C3AED] text-white shadow-sm"
                    : "text-sub hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
              {error}
              {" — "}
              <span className="text-sub">
                Is the backend running at{" "}
                <code className="text-xs">{process.env.NEXT_PUBLIC_API_URL}</code>?
              </span>
            </div>
          )}

          <div className="glass-card rounded-2xl p-6 sm:p-8">
            <AnimatePresence mode="wait">
              {tab === "repo" ? (
                <motion.form
                  key="repo"
                  onSubmit={handleRepoSubmit}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col gap-6"
                >
                  <div>
                    <label
                      htmlFor="repo-url"
                      className="mb-2 block text-sm font-medium text-sub"
                    >
                      Repository URL
                    </label>
                    <div className="flex items-center gap-2.5 rounded-xl border border-ink/10 bg-surface/70 px-3.5 py-3 backdrop-blur transition-colors focus-within:border-[#7C3AED]">
                      <Github className="h-4 w-4 shrink-0 text-sub" />
                      <input
                        id="repo-url"
                        value={repoUrl}
                        onChange={(e) => setRepoUrl(e.target.value)}
                        spellCheck={false}
                        placeholder="github.com/org/repo"
                        className="w-full bg-transparent font-mono text-sm text-ink outline-none placeholder:text-sub/60"
                      />
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-sub">
                      <Lock className="h-3 w-3" />
                      Cloned read-only — LegacyLift never writes back to your repo.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label
                      htmlFor="repo-language"
                      className="text-sm font-medium text-sub"
                    >
                      Source language
                    </label>
                    <div className="relative w-48">
                      <select
                        id="repo-language"
                        value={repoLang}
                        onChange={(e) =>
                          setRepoLang(e.target.value as ProjectLanguage)
                        }
                        className="w-full appearance-none rounded-xl border border-ink/10 bg-surface/70 px-3 py-2 text-sm text-ink outline-none backdrop-blur transition-colors focus:border-[#7C3AED]"
                      >
                        {LANGUAGES.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || repoUrl.trim().length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading ? "Cloning…" : "Analyze repository"}
                    <ArrowRight className="h-4 w-4" />
                  </button>

                  <p className="text-center text-xs text-sub/70">
                    Prefilled with a sample COBOL loan engine — hit Analyze to see
                    the full pipeline on demo data.
                  </p>
                </motion.form>
              ) : (
                <motion.div
                  key="files"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <FileUpload onSubmit={handleFileSubmit} loading={loading} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <p className="mt-6 text-center text-xs text-sub/70">
            Nothing leaves your machine until you start the analysis · tree-sitter
            parsing · human-gated merges
          </p>
        </main>
        <Footer />
      </div>
    </div>
  );
}
