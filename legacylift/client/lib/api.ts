import type {
  ApproveChunkRequest,
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectLanguage,
  RejectChunkRequest,
  RuleStatus,
} from "@/types/legacylift";
import type { Lesson, LessonSource } from "@/lib/lessons";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_HOST
    ? `https://${process.env.NEXT_PUBLIC_API_HOST}`
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface ApiErrorBody {
  detail?: string | Array<{ loc?: Array<string | number>; msg?: string }>;
  message?: string;
}

function formatApiError(body: ApiErrorBody, fallback: string): string {
  if (typeof body.detail === "string") {
    return body.detail;
  }
  if (Array.isArray(body.detail) && body.detail.length > 0) {
    return body.detail
      .map((item) => {
        const path = item.loc?.join(".");
        return path ? `${path}: ${item.msg ?? "Invalid value"}` : item.msg;
      })
      .filter(Boolean)
      .join("; ");
  }
  return body.message ?? fallback;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    // window.Clerk is set by @clerk/nextjs automatically on the client side
    const token = await (window as any).Clerk?.session?.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { ignoreNotFound?: boolean } = {},
): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...authHeaders,
      ...init.headers,
    },
  });

  if (options.ignoreNotFound && response.status === 404) {
    return undefined as T;
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      message = formatApiError(body, message);
    } catch {
      // Keep the HTTP status message when the response is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * POST a JSON body to the backend API and return the parsed JSON response.
 * Goes through the same base-URL + Clerk-auth + error-normalisation path as
 * every other backend call. Used by lib/migration.ts for the LLM endpoints.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return await request<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function toSourceLanguage(language: ProjectLanguage): string {
  return language;
}

function toBackendChunkId(ruleIdOrChunkId: string): string {
  if (ruleIdOrChunkId.startsWith("rule_")) {
    return ruleIdOrChunkId.slice("rule_".length);
  }
  if (ruleIdOrChunkId.startsWith("rule-")) {
    return ruleIdOrChunkId.slice("rule-".length);
  }
  return ruleIdOrChunkId;
}

export async function createProject(
  body: CreateProjectRequest,
): Promise<CreateProjectResponse> {
  return await request<CreateProjectResponse>("/project", {
    method: "POST",
    body: JSON.stringify({
      name: body.name,
      source_language: toSourceLanguage(body.language),
      target_language: body.targetLanguage ?? "Python",
    }),
  });
}

export async function uploadFiles(
  projectId: string,
  files: File[],
  schema?: File,
): Promise<void> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  if (schema) {
    formData.append("files", schema);
  }

  await request<unknown>(`/project/${encodeURIComponent(projectId)}/upload`, {
    method: "POST",
    body: formData,
  });
}

export async function startPipeline(projectId: string): Promise<void> {
  await request<unknown>(`/project/${encodeURIComponent(projectId)}/start`, {
    method: "POST",
  });
}

export async function approveChunk(
  projectId: string,
  body: ApproveChunkRequest,
): Promise<void> {
  await request<unknown>(
    `/project/${encodeURIComponent(projectId)}/approve/${encodeURIComponent(
      body.chunk_id,
    )}`,
    {
      method: "POST",
      body: JSON.stringify({ comment: null }),
    },
  );
}

export async function rejectChunk(
  projectId: string,
  body: RejectChunkRequest,
): Promise<void> {
  await request<unknown>(
    `/project/${encodeURIComponent(projectId)}/reject/${encodeURIComponent(
      body.chunk_id,
    )}`,
    {
      method: "POST",
      body: JSON.stringify({ comment: body.reason }),
    },
  );
}

export async function confirmBusinessRule(
  projectId: string,
  chunkId: string,
): Promise<void> {
  await request<unknown>(
    `/project/${encodeURIComponent(projectId)}/confirm-rule/${encodeURIComponent(
      chunkId,
    )}`,
    {
      method: "POST",
    },
  );
}

export async function selectChunkForMigration(
  projectId: string,
  chunkId: string,
): Promise<void> {
  await request<unknown>(
    `/project/${encodeURIComponent(projectId)}/select-chunk/${encodeURIComponent(
      chunkId,
    )}`,
    {
      method: "POST",
    },
  );
}

export interface ServerProject {
  project_id: string;
  name: string;
  status: string;
  /** Original analysis source ("upload" | "github:owner/repo") for cloud projects; null otherwise. */
  source: string | null;
  source_language: string;
  target_language: string;
  chunk_count: number;
  chunks_approved: number;
  created_at: string;
  completed_at: string | null;
}

export interface UserLimits {
  user_id: string;
  max_projects: number;
  projects_used: number;
  projects_remaining: number;
  max_files_per_project: number;
  max_file_size_mb: number;
  max_migrations_per_day: number;
  migrations_today: number;
  migrations_remaining: number;
}

export async function listServerProjects(): Promise<ServerProject[]> {
  try {
    const data = await request<{ projects: ServerProject[] }>("/projects");
    return data.projects;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cloud (DB-backed) workbench persistence — the signed-in New Migration flow.
// Mirrors client/lib/projectStore.ts's localStorage API, but every blob is
// stored server-side against the authenticated user via the /project/import,
// /progress, and /workbench endpoints.
// ---------------------------------------------------------------------------

export interface ImportProjectResponse {
  project_id: string;
  name: string;
  status: string;
  created_at: string;
}

/** Persist a browser-computed AnalyzeResult as a new cloud project. Returns the
 *  minted "cloud-" project id. Requires the user to be signed in (Clerk token). */
export async function importAnalysis(
  analysis: unknown,
  sourceLanguage?: string,
  config?: unknown,
): Promise<ImportProjectResponse> {
  return await request<ImportProjectResponse>("/project/import", {
    method: "POST",
    body: JSON.stringify({ analysis, source_language: sourceLanguage, config }),
  });
}

export interface WorkbenchProgressChunk {
  id: string;
  status: string;
  migrated_code: string;
  static_analysis: unknown | null;
  ai_review: unknown | null;
  test_results: unknown[];
}

/** Save the full workbench progress (code, checks, tests, status, finalized
 *  files, and the human-authored config) for a cloud project. */
export async function saveWorkbenchProgress(
  projectId: string,
  chunks: WorkbenchProgressChunk[],
  finalizedFiles: Record<string, boolean>,
  config?: unknown,
): Promise<void> {
  await request<unknown>(`/project/${encodeURIComponent(projectId)}/progress`, {
    method: "PUT",
    body: JSON.stringify({ chunks, finalized_files: finalizedFiles, config }),
  });
}

export interface WorkbenchSnapshot {
  project_id: string;
  analysis: unknown;
  progress: Record<string, WorkbenchProgressChunk & Record<string, unknown>>;
  file_status: Record<string, boolean>;
  config?: unknown;
}

/** Fetch a cloud project's stored analysis + progress for rehydration.
 *  Returns undefined when the project has no stored workbench (404). */
export async function getWorkbench(
  projectId: string,
): Promise<WorkbenchSnapshot | undefined> {
  return await request<WorkbenchSnapshot | undefined>(
    `/project/${encodeURIComponent(projectId)}/workbench`,
    {},
    { ignoreNotFound: true },
  );
}

/** Delete a DB-backed project the user owns (cloud or pipeline). */
export async function deleteServerProject(projectId: string): Promise<void> {
  await request<unknown>(`/project/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export async function getUserLimits(): Promise<UserLimits | null> {
  try {
    return await request<UserLimits>("/user/limits");
  } catch {
    return null;
  }
}

export interface ServerProjectFile {
  filename: string;
  content: string;
  language: string;
}

export async function getProjectFiles(
  projectId: string,
): Promise<ServerProjectFile[]> {
  const data = await request<{ files: ServerProjectFile[] } | undefined>(
    `/project/${encodeURIComponent(projectId)}/files`,
    {},
    { ignoreNotFound: true },
  );
  return data?.files ?? [];
}

interface ServerLesson {
  id: string;
  source: string;
  source_file?: string | null;
  chunk_name?: string | null;
  text: string;
  created_at: string;
}

function toClientLesson(lesson: ServerLesson): Lesson {
  return {
    id: lesson.id,
    source: lesson.source as LessonSource,
    sourceFile: lesson.source_file ?? undefined,
    chunkName: lesson.chunk_name ?? undefined,
    text: lesson.text,
    createdAt: lesson.created_at,
  };
}

export async function getProjectLessons(projectId: string): Promise<Lesson[]> {
  const data = await request<{ lessons: ServerLesson[] }>(
    `/project/${encodeURIComponent(projectId)}/lessons`,
  );
  return data.lessons.map(toClientLesson);
}

export async function addProjectLesson(
  projectId: string,
  lesson: Lesson,
): Promise<Lesson> {
  const data = await request<{ lesson: ServerLesson }>(
    `/project/${encodeURIComponent(projectId)}/lessons`,
    {
      method: "POST",
      body: JSON.stringify({
        source: lesson.source,
        text: lesson.text,
        source_file: lesson.sourceFile,
        chunk_name: lesson.chunkName,
      }),
    },
  );
  return toClientLesson(data.lesson);
}

export async function updateBusinessRule(
  projectId: string,
  ruleIdOrChunkId: string,
  patch: {
    status?: RuleStatus;
    action?: string;
    owner?: string;
    reason?: string;
    allow_unknown_owner?: boolean;
  },
): Promise<void> {
  if (!patch.action && patch.status !== "Confirmed" && patch.status !== "Flagged") {
    return;
  }

  await request<unknown>(
    `/project/${encodeURIComponent(projectId)}/confirm-rule/${encodeURIComponent(
      toBackendChunkId(ruleIdOrChunkId),
    )}`,
    {
      method: "POST",
      body: JSON.stringify({
        action:
          patch.action ??
          (patch.status === "Flagged" ? "flag" : "confirm_owner"),
        owner: patch.owner,
        reason: patch.reason,
        allow_unknown_owner: patch.allow_unknown_owner ?? false,
        source_surface: "LegacyLift workbench",
      }),
    },
  );
}
