"use client";
// app/demo/page.tsx — File upload page. Creates a project via the API then redirects
// to /project/[id] where the full workbench loads.
//
// TODO: Add a project name field so teams can label their migrations.
// TODO: Show a progress indicator while the server processes the upload.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/shared/Navbar";
import { Footer } from "@/components/shared/Footer";
import { FileUpload } from "@/components/pipeline/FileUpload";
import { createProject, uploadFiles, startPipeline } from "@/lib/api";
import type { ProjectLanguage } from "@/types/legacylift";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
// Fixed project ID used for demo — the workbench renders placeholder data for any ID.
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

    // In demo mode skip the API entirely — go straight to the workbench.
    // The workbench renders with placeholder data and connects to WS if available.
    if (DEMO_MODE) {
      router.push(`/project/${DEMO_PROJECT_ID}`);
      return;
    }

    try {
      // 1. Create project
      const { project_id } = await createProject({ name: "Migration", language });

      // 2. Upload files
      await uploadFiles(project_id, files, schema ?? undefined);

      // 3. Kick off pipeline
      await startPipeline(project_id);

      // 4. Navigate to workbench
      router.push(`/project/${project_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="dark min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-white">Start a migration</h1>
          <p className="mt-2 text-sm text-[#888888]">
            Upload your legacy source files. LegacyLift will analyse them and
            open the workbench where you can review every extracted rule before
            migration begins.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
            {error}
            {" — "}
            <span className="text-[#888888]">
              Is the backend running at{" "}
              <code className="text-xs">{process.env.NEXT_PUBLIC_API_URL}</code>?
            </span>
          </div>
        )}

        <div className="rounded-xl border border-[#222222] bg-[#111111] p-8">
          <FileUpload onSubmit={handleSubmit} loading={loading} />
        </div>

        <p className="mt-6 text-center text-xs text-[#444444]">
          Demo mode uses a sample COBOL payroll system with 12 business rules.
          No files leave your machine until you click "Start Analysis".
        </p>
      </main>
      <Footer />
    </div>
  );
}
