"use client";
// FileUpload — Drag-and-drop upload component for legacy source files and SQL schema.
// Supports multi-file drop for source code and a separate single-file drop for schema.
// "Use demo data" button bypasses the upload and loads sample COBOL fixtures.
//
// TODO: Show per-file progress bars using the XHR upload API instead of fetch.
// TODO: Validate file extensions against the selected language on the client side.

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, File as FileIcon, X, ChevronDown } from "lucide-react";
import type { ProjectLanguage } from "@/types/legacylift";

const DEMO_LABEL = "PAYROLL.cbl (sample COBOL — 847 lines)";
const LANGUAGES: ProjectLanguage[] = ["COBOL", "Java", "VB6"];

interface FileUploadProps {
  onSubmit: (files: File[], schema: File | null, language: ProjectLanguage) => Promise<void>;
  loading: boolean;
}

export function FileUpload({ onSubmit, loading }: FileUploadProps) {
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [schemaFile, setSchemaFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<ProjectLanguage>("COBOL");
  const [dragging, setDragging] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    setSourceFiles((prev) => [...prev, ...dropped]);
  }, []);

  const removeFile = (index: number) => {
    setSourceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const loadDemoData = () => {
    setDemoMode(true);
    setSourceFiles([]);
    setSchemaFile(null);
    setLanguage("COBOL");
  };

  const handleSubmit = async () => {
    if (demoMode) {
      // TODO: Create a demo Blob with sample COBOL content from /public/assets/demo/
      const demoBlob = new Blob(
        ["       IDENTIFICATION DIVISION.\n       PROGRAM-ID. PAYROLL.\n       * TODO: load real demo COBOL from /public/assets/demo/PAYROLL.cbl\n"],
        { type: "text/plain" },
      );
      const demoFile = new File([demoBlob], "PAYROLL.cbl");
      await onSubmit([demoFile], null, "COBOL");
    } else {
      await onSubmit(sourceFiles, schemaFile, language);
    }
  };

  const canSubmit = (demoMode || sourceFiles.length > 0) && !loading;

  return (
    <div className="flex flex-col gap-6">
      {/* Language selector */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-[#888888]">Source language</label>
        <div className="relative w-48">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as ProjectLanguage)}
            className="w-full appearance-none rounded-lg border border-[#222222] bg-[#111111] px-3 py-2 text-sm text-white focus:border-[#2563EB] focus:outline-none"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-[#888888]" />
        </div>
      </div>

      {/* Source files drop zone */}
      <div>
        <label className="mb-2 block text-sm font-medium text-[#888888]">
          Legacy source files
        </label>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            dragging
              ? "border-[#2563EB] bg-[#2563EB]/5"
              : "border-[#222222] bg-[#111111] hover:border-[#444444]"
          } ${demoMode ? "opacity-40 pointer-events-none" : ""}`}
          onClick={() => document.getElementById("source-file-input")?.click()}
        >
          <Upload className="mb-3 h-8 w-8 text-[#444444]" />
          <p className="text-sm text-[#888888]">
            Drop {language} files here or <span className="text-[#2563EB]">browse</span>
          </p>
          <p className="mt-1 text-xs text-[#444444]">
            Supports .cbl .cob .java .vb .bas
          </p>
          <input
            id="source-file-input"
            type="file"
            multiple
            className="sr-only"
            accept=".cbl,.cob,.java,.vb,.bas,.txt"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              setSourceFiles((prev) => [...prev, ...files]);
            }}
          />
        </div>

        {/* File list */}
        <AnimatePresence>
          {sourceFiles.map((file, i) => (
            <motion.div
              key={`${file.name}-${i}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 flex items-center justify-between rounded-lg border border-[#222222] bg-[#111111] px-3 py-2"
            >
              <div className="flex items-center gap-2 text-sm text-[#888888]">
                <FileIcon className="h-4 w-4 text-[#2563EB]" />
                <span>{file.name}</span>
                <span className="text-xs text-[#444444]">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
              <button
                onClick={() => removeFile(i)}
                className="text-[#444444] hover:text-[#EF4444] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Schema upload */}
      <div>
        <label className="mb-2 block text-sm font-medium text-[#888888]">
          SQL schema{" "}
          <span className="text-[#444444]">(optional)</span>
        </label>
        <div
          className={`flex items-center gap-3 rounded-xl border border-dashed border-[#222222] bg-[#111111] p-4 ${demoMode ? "opacity-40 pointer-events-none" : ""}`}
          onClick={() => document.getElementById("schema-file-input")?.click()}
        >
          <FileIcon className="h-5 w-5 text-[#444444]" />
          <span className="text-sm text-[#888888]">
            {schemaFile ? schemaFile.name : "Drop .sql file here or browse"}
          </span>
          <input
            id="schema-file-input"
            type="file"
            className="sr-only"
            accept=".sql,.ddl"
            onChange={(e) => setSchemaFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      {/* Demo data */}
      {demoMode ? (
        <div className="flex items-center justify-between rounded-lg border border-[#00C48C]/30 bg-[#00C48C]/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-[#00C48C]">
            <FileIcon className="h-4 w-4" />
            {DEMO_LABEL}
          </div>
          <button
            onClick={() => setDemoMode(false)}
            className="text-xs text-[#888888] hover:text-white transition-colors"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          onClick={loadDemoData}
          className="text-sm text-[#888888] hover:text-white transition-colors underline underline-offset-4"
        >
          Use demo data instead
        </button>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="rounded-lg bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? "Starting analysis…" : "Start Analysis →"}
      </button>
    </div>
  );
}
