import type {
  ApproveChunkRequest,
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectLanguage,
  RejectChunkRequest,
  RuleStatus,
} from "@/types/legacylift";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_HOST
    ? `https://${process.env.NEXT_PUBLIC_API_HOST}`
    : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface ApiErrorBody {
  detail?: string;
  message?: string;
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
      message = body.detail ?? body.message ?? message;
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
      target_language: "Python",
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

export async function getUserLimits(): Promise<UserLimits | null> {
  try {
    return await request<UserLimits>("/user/limits");
  } catch {
    return null;
  }
}

export async function updateBusinessRule(
  projectId: string,
  ruleIdOrChunkId: string,
  patch: { status: RuleStatus },
): Promise<void> {
  if (patch.status !== "Confirmed") {
    return;
  }

  await confirmBusinessRule(projectId, toBackendChunkId(ruleIdOrChunkId));
}
