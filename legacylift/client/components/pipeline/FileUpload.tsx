"use client";
// FileUpload - Drag-and-drop upload component for legacy source files and SQL schema.

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, File as FileIcon, Upload, X } from "lucide-react";
import type { ProjectLanguage } from "@/types/legacylift";
import { DEFAULT_TARGET_ID } from "@/lib/targetLanguages";
import { TargetLanguageSelect } from "@/components/workbench/TargetLanguageSelect";

const DEMO_LABEL = "PAYROLL.cbl (sample COBOL - 847 lines)";
const LANGUAGES: ProjectLanguage[] = ["COBOL", "Java", "VB6"];

interface FileUploadProps {
  onSubmit: (
    files: File[],
    schema: File | null,
    language: ProjectLanguage,
    targetId: string,
  ) => Promise<void>;
  loading: boolean;
}

function fileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function FileUpload({ onSubmit, loading }: FileUploadProps) {
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const schemaInputRef = useRef<HTMLInputElement>(null);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [schemaFile, setSchemaFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<ProjectLanguage>("COBOL");
  const [targetId, setTargetId] = useState<string>(DEFAULT_TARGET_ID);
  const [sourceDragging, setSourceDragging] = useState(false);
  const [schemaDragging, setSchemaDragging] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  const addSourceFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;

    setDemoMode(false);
    setSourceFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const next = [...prev];

      for (const file of files) {
        const key = fileKey(file);
        if (!seen.has(key)) {
          seen.add(key);
          next.push(file);
        }
      }

      return next;
    });
  }, []);

  const setSchema = useCallback((file: File | null) => {
    setDemoMode(false);
    setSchemaFile(file);
  }, []);

  const openSourcePicker = () => {
    sourceInputRef.current?.click();
  };

  const openSchemaPicker = () => {
    schemaInputRef.current?.click();
  };

  const activateOnKeyboard = (
    e: React.KeyboardEvent<HTMLDivElement>,
    callback: () => void,
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      callback();
    }
  };

  const handleSourceDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setSourceDragging(false);
      addSourceFiles(Array.from(e.dataTransfer.files));
    },
    [addSourceFiles],
  );

  const handleSchemaDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setSchemaDragging(false);
      setSchema(e.dataTransfer.files[0] ?? null);
    },
    [setSchema],
  );

  const removeFile = (index: number) => {
    setSourceFiles((prev) => prev.filter((_, i) => i !== index));
    if (sourceInputRef.current) {
      sourceInputRef.current.value = "";
    }
  };

  const removeSchema = () => {
    setSchema(null);
    if (schemaInputRef.current) {
      schemaInputRef.current.value = "";
    }
  };

  const loadDemoData = () => {
    setDemoMode(true);
    setSourceFiles([]);
    setSchemaFile(null);
    setLanguage("COBOL");
    if (sourceInputRef.current) sourceInputRef.current.value = "";
    if (schemaInputRef.current) schemaInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (demoMode) {
      const demoBlob = new Blob(
        [
          "       IDENTIFICATION DIVISION.\n" +
            "       PROGRAM-ID. PAYROLL.\n" +
            "       PROCEDURE DIVISION.\n" +
            "       0000-MAIN-PARA.\n" +
            "           DISPLAY 'PROCESS PAYROLL'.\n" +
            "           STOP RUN.\n",
        ],
        { type: "text/plain" },
      );
      const demoFile = new File([demoBlob], "PAYROLL.cbl", {
        type: "text/plain",
      });
      await onSubmit([demoFile], null, "COBOL", targetId);
    } else {
      await onSubmit(sourceFiles, schemaFile, language, targetId);
    }
  };

  const canSubmit = (demoMode || sourceFiles.length > 0) && !loading;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-2">
          <label htmlFor="source-language" className="text-sm font-medium text-sub">
            Source language
          </label>
          <div className="relative w-48">
            <select
              id="source-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as ProjectLanguage)}
              className="w-full appearance-none rounded-xl border border-ink/10 bg-surface/70 px-3 py-2 text-sm text-ink outline-none backdrop-blur transition-colors focus:border-[#7C3AED]"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-sub" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-sub">Target language</label>
          <TargetLanguageSelect
            value={targetId}
            onChange={setTargetId}
            className="w-48"
            ariaLabel="Target language"
            title="Default target language - override per file later on the Overview"
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-sub">
          Legacy source files
        </label>
        <div
          role="button"
          tabIndex={demoMode ? -1 : 0}
          aria-disabled={demoMode}
          onKeyDown={(e) => activateOnKeyboard(e, openSourcePicker)}
          onDragEnter={(e) => {
            e.preventDefault();
            setSourceDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setSourceDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setSourceDragging(false);
            }
          }}
          onDrop={handleSourceDrop}
          className={`relative flex min-h-[176px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            sourceDragging
              ? "border-[#7C3AED] bg-[#7C3AED]/10"
              : "border-ink/10 bg-surface/45 hover:border-[#7C3AED]/40 hover:bg-surface/65"
          } ${demoMode ? "pointer-events-none opacity-45" : ""}`}
          onClick={openSourcePicker}
        >
          <Upload className="mb-3 h-8 w-8 text-[#7C3AED]" />
          <p className="text-sm text-sub">
            Drop {language} files here or{" "}
            <span className="font-medium text-[#7C3AED]">browse</span>
          </p>
          <p className="mt-1 text-xs text-sub/70">
            Supports .cbl .cob .cpy .java .vb .bas .frm .cls
          </p>
          <input
            ref={sourceInputRef}
            type="file"
            multiple
            className="sr-only"
            accept=".cbl,.cob,.cpy,.java,.vb,.bas,.frm,.cls"
            onChange={(e) => {
              addSourceFiles(Array.from(e.target.files ?? []));
              e.currentTarget.value = "";
            }}
          />
        </div>

        <AnimatePresence>
          {sourceFiles.map((file, i) => (
            <motion.div
              key={fileKey(file)}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 flex items-center justify-between rounded-xl border border-ink/10 bg-surface/55 px-3 py-2 backdrop-blur"
            >
              <div className="flex min-w-0 items-center gap-2 text-sm text-sub">
                <FileIcon className="h-4 w-4 shrink-0 text-[#7C3AED]" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-sub/70">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={`Remove ${file.name}`}
                className="ml-3 text-sub transition-colors hover:text-[#EF4444]"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-sub">
          SQL schema <span className="text-sub/70">(optional)</span>
        </label>
        <div
          role="button"
          tabIndex={demoMode ? -1 : 0}
          aria-disabled={demoMode}
          onKeyDown={(e) => activateOnKeyboard(e, openSchemaPicker)}
          onDragEnter={(e) => {
            e.preventDefault();
            setSchemaDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setSchemaDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setSchemaDragging(false);
            }
          }}
          onDrop={handleSchemaDrop}
          className={`flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed p-4 transition-colors ${
            schemaDragging
              ? "border-[#7C3AED] bg-[#7C3AED]/10"
              : "border-ink/10 bg-surface/45 hover:border-[#7C3AED]/40 hover:bg-surface/65"
          } ${demoMode ? "pointer-events-none opacity-45" : ""}`}
          onClick={openSchemaPicker}
        >
          <FileIcon className="h-5 w-5 shrink-0 text-[#7C3AED]" />
          <span className="min-w-0 flex-1 truncate text-sm text-sub">
            {schemaFile ? schemaFile.name : "Drop .sql file here or browse"}
          </span>
          {schemaFile && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeSchema();
              }}
              aria-label={`Remove ${schemaFile.name}`}
              className="shrink-0 text-sub transition-colors hover:text-[#EF4444]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <input
            ref={schemaInputRef}
            type="file"
            className="sr-only"
            accept=".sql,.ddl"
            onChange={(e) => {
              setSchema(e.target.files?.[0] ?? null);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </div>

      {demoMode ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#00C48C]/25 bg-[#00C48C]/10 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm text-[#047857] dark:text-[#00C48C]">
            <FileIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{DEMO_LABEL}</span>
          </div>
          <button
            type="button"
            onClick={() => setDemoMode(false)}
            className="shrink-0 text-xs text-sub transition-colors hover:text-ink"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={loadDemoData}
          className="w-fit text-sm font-medium text-sub underline underline-offset-4 transition-colors hover:text-ink"
        >
          Use demo data instead
        </button>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="inline-flex items-center justify-center rounded-xl bg-[#7C3AED] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-colors hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? "Starting analysis..." : "Start Analysis ->"}
      </button>
    </div>
  );
}
