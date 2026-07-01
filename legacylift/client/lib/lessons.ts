// lib/lessons.ts — The "reinforced learning" loop, in practice: Venice is a
// hosted third-party model with no fine-tuning access, so there's no weight
// training here. Instead, every rejection reason and every review finding
// (chunk/file/project level) is captured as a persistent "lesson" and
// re-injected into future migration prompts — in-context learning across
// regenerations, not model training.

export type LessonSource = "rejection" | "ai_review" | "file_check" | "project_review";

export interface Lesson {
  id: string;
  source: LessonSource;
  sourceFile?: string;
  chunkName?: string;
  text: string;
  createdAt: string;
}

export function makeLesson(input: Omit<Lesson, "id" | "createdAt">): Lesson {
  return {
    ...input,
    id: `lesson-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
}

/** Prioritize lessons tied to this file, then project-wide ones, most recent first. */
export function selectRelevantLessons(
  lessons: Lesson[],
  filename: string,
  limit = 12,
): Lesson[] {
  const forFile = lessons.filter((l) => l.sourceFile === filename);
  const projectWide = lessons.filter((l) => !l.sourceFile);
  const byRecency = (a: Lesson, b: Lesson) => (a.createdAt < b.createdAt ? 1 : -1);
  return [...forFile.sort(byRecency), ...projectWide.sort(byRecency)].slice(0, limit);
}

export function formatLessonsBlock(lessons: Lesson[]): string {
  if (lessons.length === 0) return "";
  return lessons.map((l) => `- (${l.source}) ${l.text}`).join("\n");
}
