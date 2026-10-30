import { afterEach, expect, it, vi } from "vitest";
import { waitForJob } from "./api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps polling a saved waiting job until it completes", async () => {
  vi.useFakeTimers();
  const waiting = {
    status: "waiting",
    retry_at: 123,
    error: "Response validation failed",
  };
  const complete = { status: "completed" };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => waiting })
      .mockResolvedValueOnce({ ok: true, json: async () => complete }),
  );
  const progress = vi.fn();
  const pending = waitForJob("saved-job", progress);
  await vi.advanceTimersByTimeAsync(1500);
  await expect(pending).resolves.toEqual(complete);
  expect(progress).toHaveBeenNthCalledWith(1, waiting);
  expect(progress).toHaveBeenLastCalledWith(complete);
});
