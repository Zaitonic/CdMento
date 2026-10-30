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
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
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
export async function waitForJob(id: string, onProgress?: (job: any) => void) {
  for (let i = 0; i < 240; i++) {
    let job;
    try {
      job = await api("/jobs/" + id);
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
