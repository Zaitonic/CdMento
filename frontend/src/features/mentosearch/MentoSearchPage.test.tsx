import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MentoSearchPage from "./MentoSearchPage";
import { runMentoSearch } from "./searchProviders";

vi.mock("./searchProviders", () => ({
  SOURCES: [
    {
      id: "alpha",
      name: "Alpha",
      description: "First test source",
      defaultEnabled: true,
      search: vi.fn(),
    },
    {
      id: "beta",
      name: "Beta",
      description: "Second test source",
      defaultEnabled: false,
      search: vi.fn(),
    },
  ],
  runMentoSearch: vi.fn(),
}));

const result = {
  id: "alpha-1",
  title: "Spaced repetition helps long-term recall",
  url: "https://example.org/paper/1",
  sourceId: "alpha",
  sourceName: "Alpha",
  authors: ["Ada Lovelace", "Grace Hopper"],
  abstract: "A controlled study of retrieval practice.",
  year: 2020,
  citations: 12,
  doi: "10.1/example",
  rank: 0,
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(runMentoSearch).mockReset();
});

describe("MentoSearch page", () => {
  it("renders the trusted sources with their defaults and toggles them", async () => {
    const user = userEvent.setup();
    render(<MentoSearchPage />);

    expect(screen.getByRole("heading", { name: "MentoSearch" })).toBeTruthy();

    const alpha = screen.getByRole("button", { name: /Alpha/ });
    const beta = screen.getByRole("button", { name: /Beta/ });
    expect(alpha.getAttribute("aria-pressed")).toBe("true");
    expect(beta.getAttribute("aria-pressed")).toBe("false");

    await user.click(beta);
    await user.click(alpha);

    expect(beta.getAttribute("aria-pressed")).toBe("true");
    expect(alpha.getAttribute("aria-pressed")).toBe("false");
  });

  it("runs a search with the selected sources and renders the results", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [result],
      failedSources: [],
      succeededCount: 1,
    });

    render(<MentoSearchPage />);
    await user.type(
      screen.getByRole("textbox", { name: "Search topics" }),
      "spaced repetition",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText(/Spaced repetition helps long-term recall/)).toBeTruthy();
    expect(screen.getByText(/1 results for/)).toBeTruthy();
    expect(screen.getByText(/Ada Lovelace, Grace Hopper/)).toBeTruthy();
    expect(screen.getByText(/DOI: 10.1\/example/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open in Google Scholar" }).getAttribute("href"),
    ).toContain("scholar.google.com/scholar?q=spaced%20repetition");

    expect(runMentoSearch).toHaveBeenCalledTimes(1);
    const [query, sources, signal] = vi.mocked(runMentoSearch).mock.calls[0];
    expect(query).toBe("spaced repetition");
    expect([...sources]).toEqual(["alpha"]);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("shows the provider error when the search fails", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockRejectedValue(
      new Error("Enable at least one trusted source to search."),
    );

    render(<MentoSearchPage />);
    await user.type(
      screen.getByRole("textbox", { name: "Search topics" }),
      "quantum biology",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("Enable at least one trusted source to search."),
    ).toBeTruthy();
  });

  it("disables the submit button until a query is entered", async () => {
    const user = userEvent.setup();
    render(<MentoSearchPage />);

    const submit = screen.getByRole("button", { name: "Search" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await user.type(
      screen.getByRole("textbox", { name: "Search topics" }),
      "memory",
    );
    expect(submit.disabled).toBe(false);
  });

  it("persists the selected sources and sort order", async () => {
    const user = userEvent.setup();
    render(<MentoSearchPage />);

    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("button", { name: "Newest" }));

    expect(
      JSON.parse(localStorage.getItem("mentosearch-preferences:v2") || "{}"),
    ).toEqual({ sources: ["alpha", "beta"], sort: "newest" });
  });

  it("warns when a trusted source is unavailable", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [],
      failedSources: ["Alpha"],
      succeededCount: 0,
    });

    render(<MentoSearchPage />);
    await user.type(
      screen.getByRole("textbox", { name: "Search topics" }),
      "spaced repetition",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText(/Alpha is unavailable right now/)).toBeTruthy();
    expect(screen.getByText(/selected sources are unavailable/)).toBeTruthy();
  });

  it("orders results newest first when the newest sort is selected", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [
        result,
        {
          ...result,
          id: "alpha-2",
          title: "Interleaving practice beats blocking",
          url: "https://example.org/paper/2",
          year: 2024,
          doi: "10.1/newer",
          rank: 1,
        },
      ],
      failedSources: [],
      succeededCount: 1,
    });

    const { container } = render(<MentoSearchPage />);
    await user.click(screen.getByRole("button", { name: "Newest" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search topics" }),
      "spaced repetition",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText(/Interleaving practice beats blocking/);
    const titles = Array.from(container.querySelectorAll(".result-title")).map(
      (node) => node.textContent?.trim(),
    );
    expect(titles[0]).toContain("Interleaving practice beats blocking");
    expect(titles[1]).toContain("Spaced repetition helps long-term recall");
  });

  it("shows the no-results message only once", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [],
      failedSources: [],
      succeededCount: 1,
    });

    render(<MentoSearchPage />);
    await user.type(
      screen.getByRole("textbox", { name: "Search topics" }),
      "nonexistent topic",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText(/No results found/);
    expect(screen.getAllByText(/No results found/)).toHaveLength(1);
  });
});
