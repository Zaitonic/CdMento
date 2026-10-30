import { beforeEach, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: apiMock, json: JSON.stringify }));

import { activeNotebookKey, useStore } from "./store";

const notebooks = [
  { id: "a", name: "Alpha", color: "purple" },
  { id: "b", name: "Beta", color: "blue" },
  { id: "c", name: "Gamma", color: "green" },
];

function workspace(owner: string, books = notebooks) {
  apiMock.mockImplementation(async (path: string) =>
    path === "/me"
      ? { id: owner }
      : { notebooks: books, sources: [], notes: [] },
  );
}

beforeEach(() => {
  localStorage.clear();
  apiMock.mockReset();
  useStore.setState({
    notebooks: [],
    sources: [],
    notes: [],
    active: "",
    dark: false,
    ready: false,
    owner: "",
    sync: "Connecting…",
    pendingImport: null,
    recovery: null,
    selectedSources: null,
  });
});

it("restores the selected notebook for the signed-in account after refresh", async () => {
  localStorage.setItem(activeNotebookKey("alice"), "b");
  workspace("alice");
  await useStore.getState().initialize();
  expect(useStore.getState().active).toBe("b");
  useStore.getState().set({ active: "a" });
  expect(localStorage.getItem(activeNotebookKey("alice"))).toBe("a");
});

it("falls back to the first notebook when the saved notebook was deleted", async () => {
  localStorage.setItem(activeNotebookKey("alice"), "deleted-notebook");
  workspace("alice");
  await useStore.getState().initialize();
  expect(useStore.getState().active).toBe("a");
  expect(localStorage.getItem(activeNotebookKey("alice"))).toBe("a");
});

it("keeps selections separate for each account in the same browser", async () => {
  localStorage.setItem(activeNotebookKey("alice"), "b");
  localStorage.setItem(activeNotebookKey("bob"), "c");
  workspace("alice");
  await useStore.getState().initialize();
  expect(useStore.getState().active).toBe("b");
  workspace("bob");
  await useStore.getState().initialize();
  expect(useStore.getState().active).toBe("c");
});
