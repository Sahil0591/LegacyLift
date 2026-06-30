import type {
  ApproveChunkRequest,
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectLanguage,
  RejectChunkRequest,
  RuleStatus,
} from "@/types/legacylift";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
