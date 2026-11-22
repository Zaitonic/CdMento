export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
    public kind?: string,
  ) {
    super(message);
  }
}
let token = "";
export function setToken(value: string) {
  token = value;
}
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout
    ? setTimeout(() => timeout.abort(), Math.max(1, timeoutMs ?? 30000))
    : null;
  const signal = timeout
    ? init.signal
      ? AbortSignal.any([init.signal, timeout.signal])
      : timeout.signal
    : init.signal;
  let response: Response;
  try {
    response = await fetch("/api/v1" + path, {
      ...init,
      signal,
      headers: {
        ...(init.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (timeout?.signal.aborted && !init.signal?.aborted) {
      throw new ApiError(
        "This request took too long. Check your connection and retry.",
        408,
      );
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (response.status === 204) return undefined as T;
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "Cannot reach the Python API. Start npm run dev:all.",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error || "The request could not be completed.",
      response.status,
      data.retry_after,
      data.kind,
    );
  return data;
}
export const json = (value: unknown) => JSON.stringify(value);

export interface BriefEvidence {
  id: string;
  source: string;
  title: string;
  authors: string[];
  year?: number | null;
  venue?: string;
  doi?: string;
  url: string;
  abstract?: string;
  citations?: number;
  scholar_url?: string;
}

export interface BriefPoint {
  text: string;
  evidence_ids: string[];
}

export interface BriefSection {
  heading: string;
  points: BriefPoint[];
}

export interface TopicBrief {
  title: string;
  overview: string;
  overview_evidence_ids: string[];
  sections: BriefSection[];
  key_terms: string[];
  further_reading: string[];
}

export type BriefSupport = "strong" | "partial" | "general" | "evidence-only";

export interface BriefResponse {
  query: string;
  brief: TopicBrief;
  evidence: BriefEvidence[];
  coverage: { ok: string[]; failed: string[] };
  support: BriefSupport;
  cached: boolean;
  generated_at: string;
  ai?: { provider: string; model: string };
}

export function searchBrief(
  query: string,
  sources: string[],
  sort: "relevance" | "newest",
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<BriefResponse> {
  return api<BriefResponse>("/search/brief", {
    method: "POST",
    body: json({ query, sources, sort }),
    signal,
  }, timeoutMs);
}

export async function waitForJob(
  id: string,
  onProgress?: (job: any) => void,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
) {
  const timeoutMs = options.timeoutMs ?? 6 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  const signal = options.signal;
  for (let i = 0; i < 240; i++) {
    if (signal?.aborted) throw new ApiError("Processing was cancelled.", 499);
    if (Date.now() > deadline) {
      throw new Error(
        "Processing took too long. Check your connection, then retry.",
      );
    }
    let job;
    try {
      job = await api("/jobs/" + id, {}, 20_000);
    } catch (e: any) {
      if (e.status === 404)
        throw new Error(
          "This job is no longer available. It may have been removed or reset.",
        );
      throw e;
    }
    onProgress?.(job);
    if (job.status === "completed") return job;
    if (job.status === "failed") {
      const error = new Error(job.error || "Processing failed.");
      (error as Error & { kind?: string }).kind = job.error_kind;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    "Processing is still running. You can return to this notebook later.",
  );
}

// Fetch protected originals with the same session as JSON requests. No token in URLs.
export async function sourceFile(
  id: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const timeout = AbortSignal.timeout(30_000);
  try {
    const response = await fetch(
      `/api/v1/sources/${encodeURIComponent(id)}/file`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(
        data.error || "The original file could not be opened.",
        response.status,
      );
    }
    return await response.blob();
  } catch (error) {
    if (timeout.aborted)
      throw new ApiError(
        "The PDF download timed out. Retry the original or read the extracted text below.",
        408,
      );
    throw error;
  }
}
