"use client";
// app/demo/page.tsx — Start a migration. Two ways in: a public GitHub repo, or
// uploaded source files. Both POST to /api/analyze (rule-based identification +
// risk), stash the result, and open the workbench.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Github, ArrowRight, FolderUp, Lock } from "lucide-react";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { AmbientBackground } from "@/components/landing/AmbientBackground";
import { FileUpload } from "@/components/pipeline/FileUpload";
import { storeAnalysis } from "@/lib/projectStore";
import { DEMO_HERITAGE_PROJECT_ID, DEMO_PROJECT_ID } from "@/lib/demoData";
import type { AnalyzeResult } from "@/lib/analyze";
import type { ProjectLanguage } from "@/types/legacylift";

const LANGUAGES: ProjectLanguage[] = ["COBOL", "Java", "VB6"];
const SAMPLE_REPO = "github.com/aws-samples/aws-mainframe-modernization-carddemo";

type Tab = "repo" | "files";

export default function DemoPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("repo");
  const [repoUrl, setRepoUrl] = useState(SAMPLE_REPO);
  const [repoLang, setRepoLang] = useState<ProjectLanguage>("COBOL");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeAndGo = async (payload: {
    files?: { filename: string; content: string }[];
    repoUrl?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Analysis failed");
      const id = storeAnalysis(data as AnalyzeResult);
      router.push(`/project/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setLoading(false);
    }
  };

  const handleRepoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    analyzeAndGo({ repoUrl });
  };

  const handleFileSubmit = async (files: File[]) => {
    const contents = await Promise.all(
      files.map(async (f) => ({ filename: f.name, content: await f.text() })),
    );
    await analyzeAndGo({ files: contents });
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
                      Read-only — we pull up to 25 COBOL files
                      (.cbl/.cob/.cpy/.jcl) and never write back.
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
