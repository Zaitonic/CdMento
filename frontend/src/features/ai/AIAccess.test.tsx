import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIAccess, useAI } from "./AIAccess";
import { api } from "../../api";
vi.mock("../../api", () => ({ api: vi.fn(), json: JSON.stringify }));
const status = {
  configured: true,
  state: "ready" as const,
  automatic: true,
  free_only: true,
  message: "Free-tier AI is ready. Provider quotas may still apply.",
  retry_at: null,
  approved_providers: ["cloudflare", "groq"],
  providers: [
    {
      name: "cloudflare",
      model: "free-test-model",
      requests_used: 0,
      daily_cap: 100,
      disabled: false,
    },
    {
      name: "groq",
      model: "free-test-backup",
      requests_used: 0,
      daily_cap: 100,
      disabled: false,
    },
  ],
};
function Probe() {
  const ai = useAI();
  return (
    <>
      <AIAccess ai={ai} />
      <button disabled={!ai.ready}>Generate study material</button>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue(status);
});
it("shows a checking state until the AI status request resolves", async () => {
  let resolveStatus: (value: unknown) => void = () => {};
  vi.mocked(api).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveStatus = resolve;
      }) as any,
  );
  render(<Probe />);
  expect(screen.getByText("Checking AI connection…")).toBeTruthy();
  expect(screen.queryByText(/isn’t connected/)).toBeNull();
  resolveStatus({
    ...status,
    configured: false,
    state: "unconfigured",
    providers: [],
    approved_providers: [],
  });
  expect(
    await screen.findByText(/AI isn’t connected on this server yet/),
  ).toBeTruthy();
});
it("enables generation automatically without a provider permission card", async () => {
  render(<Probe />);
  expect(
    await screen.findByRole("button", { name: "Generate study material" }),
  ).toHaveProperty("disabled", false);
  expect(screen.queryByText("Allow selected providers")).toBeNull();
  expect(screen.queryByText("Manage sharing")).toBeNull();
  expect(screen.queryByText("FREE MODELS ONLY")).toBeNull();
  expect(api).not.toHaveBeenCalledWith("/ai/consent", expect.anything());
});
it("explains quota cooldown and rechecks automatically", async () => {
  vi.mocked(api).mockResolvedValue({
    ...status,
    state: "cooling_down",
    message: "Free-tier AI is cooling down.",
  });
  const user = userEvent.setup();
  render(<Probe />);
  expect(
    await screen.findByText(/Free-tier AI has used its current quota/),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Generate study material" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: /Check again/ }));
  expect(api).toHaveBeenCalledTimes(2);
});
it("surfaces a connection error with a retry action", async () => {
  vi.mocked(api).mockRejectedValue(new Error("Cannot reach the Python API."));
  render(<Probe />);
  expect(await screen.findByText(/Cannot reach the Python API/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Generate study material" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
