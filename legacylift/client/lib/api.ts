import type {
  ApproveChunkRequest,
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectLanguage,
  RejectChunkRequest,
  RuleStatus,
} from "@/types/legacylift";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface ApiErrorBody {
  detail?: string;
  message?: string;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { ignoreNotFound?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
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

function toSourceLanguage(language: ProjectLanguage): string {
  return language;
}

export async function createProject(
  body: CreateProjectRequest,
): Promise<CreateProjectResponse> {
  return request<CreateProjectResponse>("/api/project", {
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

  await request<unknown>(`/api/project/${encodeURIComponent(projectId)}/upload`, {
    method: "POST",
    body: formData,
  });
}

export async function startPipeline(projectId: string): Promise<void> {
  await request<unknown>(`/api/project/${encodeURIComponent(projectId)}/start`, {
    method: "POST",
  });
}

export async function approveChunk(
  projectId: string,
  body: ApproveChunkRequest,
): Promise<void> {
  await request<unknown>(
    `/api/project/${encodeURIComponent(projectId)}/approve/${encodeURIComponent(
      body.chunk_id,
    )}`,
    {
      method: "POST",
      body: JSON.stringify({ reviewer_comment: null }),
    },
  );
}

export async function rejectChunk(
  projectId: string,
  body: RejectChunkRequest,
): Promise<void> {
  await request<unknown>(
    `/api/project/${encodeURIComponent(projectId)}/reject/${encodeURIComponent(
      body.chunk_id,
    )}`,
    {
      method: "POST",
      body: JSON.stringify({ reviewer_comment: body.reason }),
    },
  );
}

export async function updateBusinessRule(
  projectId: string,
  ruleId: string,
  patch: { status: RuleStatus },
): Promise<void> {
  await request<unknown>(
    `/api/project/${encodeURIComponent(projectId)}/rules/${encodeURIComponent(ruleId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
    { ignoreNotFound: true },
  );
}
