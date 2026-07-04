"use client";
// app/demo/page.tsx — Start a migration. Two ways in: a public GitHub repo, or
// uploaded source files. Both POST to /api/analyze (rule-based identification +
// risk), stash the result, and open the workbench.

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Github, ArrowRight, FolderUp, Lock, ChevronDown } from "lucide-react";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { AmbientBackground } from "@/components/landing/AmbientBackground";
import { FileUpload } from "@/components/pipeline/FileUpload";
import { TargetLanguageSelect } from "@/components/workbench/TargetLanguageSelect";
import { createProject, startPipeline, uploadFiles } from "@/lib/api";
import {
  REPO_PREFIX,
  SAMPLE_REPO,
  startMigration,
  stripRepoPrefix,
} from "@/lib/startMigration";
import { DEFAULT_TARGET_ID, getTargetLanguage } from "@/lib/targetLanguages";
import { DEMO_HERITAGE_PROJECT_ID, DEMO_PROJECT_ID } from "@/lib/demoData";
import type { ProjectLanguage } from "@/types/legacylift";

const LANGUAGES: ProjectLanguage[] = ["COBOL", "Java", "VB6"];

type Tab = "repo" | "files";

function DemoPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("repo");
  // Prefill from ?repo= when the landing-page hero hands off a repo URL. The
  // input only holds the editable "org/repo" path; github.com/ is a fixed prefix.
  const [repoPath, setRepoPath] = useState(
    stripRepoPrefix(searchParams.get("repo") ?? SAMPLE_REPO),
  );
  const [repoLang, setRepoLang] = useState<ProjectLanguage>("COBOL");
  const [repoTarget, setRepoTarget] = useState<string>(DEFAULT_TARGET_ID);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRepoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // /demo is behind Clerk middleware, so the user is always signed in here;
      // startMigration persists to the DB and falls back to localStorage.
      const id = await startMigration({
        repoUrl: `${REPO_PREFIX}${stripRepoPrefix(repoPath.trim())}`,
        sourceLanguage: repoLang,
        targetId: repoTarget,
      });
      router.push(`/project/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setLoading(false);
    }
  };

  const handleFileSubmit = async (
    files: File[],
    schema: File | null,
    language: ProjectLanguage,
    targetId: string,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const projectName =
        files.length === 1
          ? files[0].name.replace(/\.[^.]+$/, "")
          : `${language} upload`;
      const project = await createProject({
        name: projectName,
        language,
        targetLanguage: getTargetLanguage(targetId).language,
      });
      await uploadFiles(project.project_id, files, schema ?? undefined);
      await startPipeline(project.project_id);
      router.push(`/project/${project.project_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project creation failed");
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
              Point LegacyLift at a legacy codebase. It identifies every unit,
              scores the risk from explicit rules, and migrates chunk by chunk —
              with you approving each step.
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
                      Public repository URL
                    </label>
                    <div className="flex items-center gap-2.5 rounded-xl border border-ink/10 bg-surface/70 px-3.5 py-3 backdrop-blur transition-colors focus-within:border-[#7C3AED]">
                      <Github className="h-4 w-4 shrink-0 text-sub" />
                      <div className="flex flex-1 items-center font-mono text-sm">
                        <span className="shrink-0 select-none text-sub">
                          {REPO_PREFIX}
                        </span>
                        <input
                          id="repo-url"
                          value={repoPath}
                          onChange={(e) =>
                            setRepoPath(stripRepoPrefix(e.target.value))
                          }
                          spellCheck={false}
                          placeholder="org/repo"
                          className="w-full bg-transparent text-ink outline-none placeholder:text-sub/60"
                        />
                      </div>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-sub">
                      <Lock className="h-3 w-3" />
                      Read-only — we pull up to 25 COBOL files
                      (.cbl/.cob/.cpy/.jcl) and never write back.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-6">
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
                          className="w-full appearance-none rounded-xl border border-ink/10 bg-surface/70 py-2 pl-3 pr-8 text-sm text-ink outline-none backdrop-blur transition-colors focus:border-[#7C3AED]"
                        >
                          {LANGUAGES.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sub" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-sub">
                        Target language
                      </label>
                      <TargetLanguageSelect
                        value={repoTarget}
                        onChange={setRepoTarget}
                        className="w-48"
                        ariaLabel="Target language"
                        title="Default target language — override per file later on the Overview"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || repoPath.trim().length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading ? "Analyzing…" : "Analyze repository"}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </button>

                  <p className="text-center text-xs text-sub/70">
                    Prefilled with a real public COBOL repo — hit Analyze to map it
                    live.
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
            Files are analysed in your browser session · risk is rule-based ·
            humans approve every merge ·{" "}
            <Link
              href={`/project/${DEMO_PROJECT_ID}`}
              className="text-[#7C3AED] underline-offset-2 hover:underline"
            >
              explore the COBOL sample
            </Link>
            {" "}or{" "}
            <Link
              href={`/project/${DEMO_HERITAGE_PROJECT_ID}`}
              className="text-[#7C3AED] underline-offset-2 hover:underline"
            >
              open heritage-payments
            </Link>
          </p>
        </main>
        <Footer />
      </div>
    </div>
  );
}

export default function DemoPage() {
  // useSearchParams (read in DemoPageContent) must sit under a Suspense
  // boundary for the production build.
  return (
    <Suspense>
      <DemoPageContent />
    </Suspense>
  );
}
