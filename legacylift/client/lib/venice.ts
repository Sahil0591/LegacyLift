// lib/venice.ts — Server-only client for the Venice AI API (OpenAI-compatible).
// Used by the /api/migrate and /api/review route handlers for code generation
// and semantic review. Never import this from a client component — it reads the
// secret VENICE_API_KEY from the server environment.

const VENICE_BASE_URL =
  process.env.VENICE_BASE_URL ?? "https://api.venice.ai/api/v1";
const VENICE_MODEL = process.env.VENICE_MODEL ?? "qwen-2.5-coder-32b";
// Reasoning models (gpt-5.x-codex, o-series) over-think and can spend the whole
// token budget reasoning, leaving an empty answer. Cap it. "" disables the param.
const VENICE_REASONING_EFFORT =
  process.env.VENICE_REASONING_EFFORT ?? "low";

export class VeniceError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "VeniceError";
    this.status = status;
  }
}

export function isVeniceConfigured(): boolean {
  return Boolean(process.env.VENICE_API_KEY);
}

export interface VeniceChatOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the model to return a JSON object (uses response_format). */
  json?: boolean;
  model?: string;
}

interface VeniceMessage {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
}
interface VeniceChoice {
  message?: VeniceMessage;
  finish_reason?: string;
}
interface VeniceResponse {
  model?: string;
  choices?: VeniceChoice[];
}

/**
 * Single non-streaming chat completion against Venice. Returns the assistant's
 * text. Throws VeniceError (with an HTTP-ish status) on any failure so route
 * handlers can map it to a response.
 */
export async function veniceChat(opts: VeniceChatOptions): Promise<{
  content: string;
  model: string;
}> {
  const key = process.env.VENICE_API_KEY;
  if (!key) {
    throw new VeniceError(
      "VENICE_API_KEY is not set. Add it to client/.env.local to enable code generation.",
      501,
    );
  }

  const model = opts.model ?? VENICE_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: opts.temperature ?? 0.2,
    // Reasoning models (e.g. gpt-5.2-codex) spend tokens thinking before they
    // emit output, so keep generous headroom. Send both spellings — OpenAI
    // reasoning models want max_completion_tokens; others use max_tokens.
    max_tokens: opts.maxTokens ?? 4096,
    max_completion_tokens: opts.maxTokens ?? 4096,
    // Venice-specific knobs: keep responses deterministic and offline.
    venice_parameters: { enable_web_search: "off", include_venice_system_prompt: false },
  };
  if (VENICE_REASONING_EFFORT) {
    body.reasoning_effort = VENICE_REASONING_EFFORT;
  }
  if (opts.json) {
    body.response_format = { type: "json_object" };
  }

  let res: Response;
  try {
    res = await fetch(`${VENICE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new VeniceError(
      `Could not reach Venice API: ${err instanceof Error ? err.message : "network error"}`,
      502,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new VeniceError(
      `Venice API error ${res.status}: ${detail.slice(0, 400)}`,
      res.status,
    );
  }

  const data = (await res.json()) as VeniceResponse;
  const choice = data.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content !== "string" || content.trim() === "") {
    const reason = choice?.finish_reason ?? "?";
    const hint =
      reason === "length"
        ? " The model spent its budget reasoning — lower VENICE_REASONING_EFFORT or raise max tokens."
        : "";
    throw new VeniceError(
      `Venice returned an empty completion (finish_reason=${reason}).${hint}`,
      502,
    );
  }

  return { content, model: data.model ?? model };
}

/** Strip a leading/trailing markdown code fence if the model added one. */
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const fence = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/;
  const m = t.match(fence);
  return (m ? m[1] : t).trim();
}

/** Best-effort parse of a JSON object the model may have wrapped in prose/fences. */
export function parseJsonLoose<T>(text: string): T | null {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
