// lib/projectReview.ts - Whole-project AI review, run once every file has
// been finalized. Calls POST /llm/review-project - the hard gate before the
// bundled/zip download unlocks.

import { apiPost } from "@/lib/api";

export interface ProjectReviewResult {
  summary: string;
  risk_notes: string[];
  cross_file_concerns: string[];
  confidence: string;
}

export function reviewProject(input: {
  projectName: string;
  manifest: string;
  fileSummaries: { filename: string; chunk_count: number; risk_level: string }[];
}): Promise<ProjectReviewResult> {
  return apiPost("/llm/review-project", {
    project_name: input.projectName,
    manifest: input.manifest,
    file_summaries: input.fileSummaries,
  });
}
