import type {
  ApproveChunkRequest,
  BusinessRule,
  CreateProjectRequest,
  CreateProjectResponse,
  RejectChunkRequest,
} from "@/types/legacylift";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface UploadFilesResponse {
  uploaded: Array<{
    filename: string;
    size_bytes: number;
  }>;
  total_files: number;
}

export interface StartPipelineResponse {
  message: string;
  project_id: string;
  status: string;
  tip?: string;
}

export interface ApiMessageResponse {
  message: string;
  project_id: string;
}

interface ApprovalMetadata {
  reviewer_comment?: string;
  reviewer_id?: string;
}

export interface BusinessRuleUpdateResponse {
  project_id: string;
  rule_id: string;
  rule: Partial<BusinessRule>;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; message?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (typeof body.message === "string") return body.message;
    return JSON.stringify(body.detail ?? body);
  } catch {
    return response.statusText;
  }
}

export async function createProject(
  request: CreateProjectRequest,
): Promise<CreateProjectResponse> {
  return requestJson<CreateProjectResponse>("/api/project", {
    method: "POST",
    body: JSON.stringify({
      name: request.name,
      source_language: request.language,
      target_language: "Python",
    }),
  });
}

export async function uploadFiles(
  projectId: string,
  files: File[],
  schema?: File,
): Promise<UploadFilesResponse> {
  const formData = new FormData();

  files.forEach((file) => formData.append("files", file));
  if (schema) formData.append("files", schema);

  return requestJson<UploadFilesResponse>(`/api/project/${projectId}/upload`, {
    method: "POST",
    body: formData,
  });
}

export async function startPipeline(
  projectId: string,
): Promise<StartPipelineResponse> {
  return requestJson<StartPipelineResponse>(`/api/project/${projectId}/start`, {
    method: "POST",
  });
}

export async function approveChunk(
  projectId: string,
  request: ApproveChunkRequest & ApprovalMetadata,
): Promise<ApiMessageResponse> {
  return requestJson<ApiMessageResponse>(
    `/api/project/${projectId}/approve/${request.chunk_id}`,
    {
      method: "POST",
      body: JSON.stringify({
        reviewer_comment: request.reviewer_comment,
        reviewer_id: request.reviewer_id,
      }),
    },
  );
}

export async function rejectChunk(
  projectId: string,
  request: RejectChunkRequest & ApprovalMetadata,
): Promise<ApiMessageResponse> {
  return requestJson<ApiMessageResponse>(
    `/api/project/${projectId}/reject/${request.chunk_id}`,
    {
      method: "POST",
      body: JSON.stringify({
        reviewer_comment: request.reviewer_comment ?? request.reason,
        reviewer_id: request.reviewer_id,
      }),
    },
  );
}

export async function updateBusinessRule(
  projectId: string,
  ruleId: string,
  patch: Partial<BusinessRule>,
): Promise<BusinessRuleUpdateResponse> {
  return Promise.resolve({
    project_id: projectId,
    rule_id: ruleId,
    rule: patch,
  });
}
