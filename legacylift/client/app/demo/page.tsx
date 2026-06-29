"use client";
// app/demo/page.tsx - File upload page. Creates a project via the API then redirects
// to /project/[id] where the full workbench loads.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { AmbientBackground } from "@/components/landing/AmbientBackground";
import { FileUpload } from "@/components/pipeline/FileUpload";
import { createProject, uploadFiles, startPipeline } from "@/lib/api";
import type { ProjectLanguage } from "@/types/legacylift";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const DEMO_PROJECT_ID = "demo-payroll-001";

export default function DemoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    files: File[],
    schema: File | null,
    language: ProjectLanguage,
  ) => {
    setLoading(true);
    setError(null);

    if (DEMO_MODE) {
      router.push(`/project/${DEMO_PROJECT_ID}`);
      return;
    }

    try {
      const { project_id } = await createProject({ name: "Migration", language });
      await uploadFiles(project_id, files, schema ?? undefined);
      await startPipeline(project_id);
      router.push(`/project/${project_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-base text-ink">
      <AmbientBackground />
      <div className="relative z-10">
        <Navbar />
        <main className="mx-auto max-w-5xl px-6 pb-20 pt-16 sm:pt-24">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#7C3AED]/20 bg-surface/60 px-4 py-1.5 text-xs font-medium text-[#7C3AED] backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#7C3AED]" />
              Migration workbench setup
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
              Start a migration
              <span className="block bg-gradient-to-r from-[#7C3AED] to-[#A855F7] bg-clip-text text-transparent">
                with the same guardrails.
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-sub sm:text-lg">
              Upload source files, attach an optional schema, and open the
              review workbench where every extracted rule and generated chunk is
              approved step by step.
            </p>
          </div>

          <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-[1fr_17rem]">
            <section className="glass-strong rounded-2xl p-5 sm:p-7">
              {error && (
                <div className="mb-5 rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
                  {error}
                  {" - "}
                  <span className="text-sub">
                    Is the backend running at{" "}
                    <code className="font-mono text-xs">
                      {process.env.NEXT_PUBLIC_API_URL}
                    </code>
                    ?
                  </span>
                </div>
              )}

              <FileUpload onSubmit={handleSubmit} loading={loading} />
            </section>

            <aside className="glass-card h-fit rounded-2xl p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7C3AED]">
                Pipeline
              </p>
              <div className="mt-5 space-y-4">
                {["Parse", "Map rules", "Score risk", "Review chunks"].map(
                  (step, index) => (
                    <div key={step} className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7C3AED]/10 font-mono text-xs font-semibold text-[#7C3AED]">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-ink">{step}</span>
                    </div>
                  ),
                )}
              </div>
              <p className="mt-6 text-sm leading-relaxed text-sub">
                Demo data uses a sample COBOL payroll system. Real uploads are
                sent only when you start analysis.
              </p>
            </aside>
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
