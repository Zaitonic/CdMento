import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SourcesPage from "./SourcesPage";
import { useStore } from "../../store";
import { api, waitForJob } from "../../api";
vi.mock("../../api", () => ({
  api: vi.fn(),
  waitForJob: vi.fn(),
  sourceFile: vi.fn(),
  json: JSON.stringify,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/ai/status"
      ? {
          configured: false,
          free_only: true,
          message: "Key needed",
          providers: [],
          approved_providers: [],
        }
      : [],
  );
  useStore.setState({
    ready: true,
    active: "notebook-test",
    notebooks: [{ id: "notebook-test", name: "Programming", color: "purple" }],
    sources: [],
    notes: [],
    flush: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
  });
});
it("keeps reviewer generation disabled while exposing upload and paste", () => {
  render(<MemoryRouter><SourcesPage /></MemoryRouter>);
  expect(
    screen
      .getByRole("button", { name: "Create reviewer" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Paste text instead" }),
  ).toBeTruthy();
  expect(api).not.toHaveBeenCalledWith(
    expect.stringContaining("/generations"),
    expect.anything(),
  );
});
it("saves pasted material through the existing document ingestion pipeline", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith("/sources")
      ? { source: { id: "source-test" }, job_id: "job-test" }
      : path === "/ai/status"
        ? {
            configured: false,
            free_only: true,
            providers: [],
            approved_providers: [],
          }
        : [],
  );
  const user = userEvent.setup();
  render(<MemoryRouter><SourcesPage /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Paste text instead" }));
  await user.type(screen.getByLabelText("Source title"), "JavaScript basics");
  await user.type(
    screen.getByLabelText("Study material"),
    "Variables store values.",
  );
  await user.click(screen.getByRole("button", { name: "Save text source" }));
  await waitFor(() => expect(waitForJob).toHaveBeenCalledWith("job-test"));
  const [path, request] = vi
    .mocked(api)
    .mock.calls.find(([path]) => path.endsWith("/sources"))!;
  expect(path).toBe("/notebooks/notebook-test/sources");
  const file = (request?.body as FormData).get("file") as File;
  expect(file.name).toBe("JavaScript basics.txt");
  expect(file.size).toBe(23);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("preserves pasted text if the upload fails", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith("/sources")) throw new Error("Connection interrupted");
    return path === "/ai/status"
      ? {
          configured: false,
          free_only: true,
          providers: [],
          approved_providers: [],
        }
      : [];
  });
  const user = userEvent.setup();
  render(<MemoryRouter><SourcesPage /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "Paste text instead" }));
  await user.type(screen.getByLabelText("Source title"), "My notes");
  await user.type(screen.getByLabelText("Study material"), "Keep this draft.");
  await user.click(screen.getByRole("button", { name: "Save text source" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Save text source" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(
    (screen.getByLabelText("Study material") as HTMLTextAreaElement).value,
  ).toBe("Keep this draft.");
});
