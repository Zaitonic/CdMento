import { afterEach, expect, it, vi } from "vitest";
import { ApiError, sourceFile } from "./api";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("downloads the complete PDF body with a timeout signal", async () => {
  const content = new Blob(["%PDF-1.4\ncomplete-file"], {
    type: "application/pdf",
  });
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, blob: async () => content });
  vi.stubGlobal("fetch", fetch);
  expect(await sourceFile("source-1")).toBe(content);
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it("reports stalled downloads instead of leaving an endless spinner", async () => {
  const controller = new AbortController();
  controller.abort();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")),
  );
  await expect(sourceFile("source-1")).rejects.toMatchObject({
    status: 408,
    message: expect.stringContaining("timed out"),
  });
});
