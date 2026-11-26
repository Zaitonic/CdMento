import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BriefResponse } from "../../lib/api";
import { searchBrief } from "../../lib/api";
import MentoSearchPage from "./MentoSearchPage";
import { runMentoSearch } from "./searchProviders";

vi.mock("../../lib/api", () => ({
  searchBrief: vi.fn(),
}));

vi.mock("./searchProviders", () => ({
  SOURCES: [
    {
      id: "google_scholar",
      name: "Google Scholar",
      description: "Server-side academic search",
      defaultEnabled: false,
      search: vi.fn(),
    },
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

const briefResponse: BriefResponse = {
  query: "IT fundamentals",
  brief: {
    title: "IT Fundamentals",
    overview:
      "Information technology covers hardware, software, networks, and data.",
    overview_evidence_ids: ["ev-1"],
    sections: [
      {
        heading: "Core areas",
        points: [
          {
            text: "Hardware is the physical equipment used by a computer.",
            evidence_ids: ["ev-1"],
          },
          {
            text: "Security protects systems and information.",
            evidence_ids: [],
          },
        ],
      },
    ],
    key_terms: ["hardware", "software", "networks"],
    further_reading: ["Information technology fundamentals"],
  },
  evidence: [
    {
      id: "ev-1",
      source: "alpha",
      title: "Information technology fundamentals",
      authors: ["Ada Lovelace", "Grace Hopper"],
      year: 2023,
      venue: "Journal of IT",
      doi: "10.1/it",
      url: "https://example.org/it",
      abstract: "A study of IT fundamentals.",
      citations: 12,
      scholar_url:
        "https://scholar.google.com/scholar?q=Information%20technology%20fundamentals",
    },
  ],
  coverage: { ok: ["alpha"], failed: [] },
  support: "partial",
  cached: false,
  generated_at: "2026-11-18T00:00:00Z",
};

const paper = {
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

async function search(user: ReturnType<typeof userEvent.setup>, query = "IT fundamentals") {
  await user.type(screen.getByRole("textbox", { name: "Search topics" }), query);
  await user.click(screen.getByRole("button", { name: "Search" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(runMentoSearch).mockReset();
  vi.mocked(searchBrief).mockReset();
  vi.mocked(searchBrief).mockResolvedValue(briefResponse);
});

describe("MentoSearch page", () => {
  it("renders the trusted sources with their defaults and toggles them", async () => {
    const user = userEvent.setup();
    render(<MentoSearchPage />);

    expect(screen.getByRole("heading", { name: "MentoSearch" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Advanced sources/ }));
    const alpha = screen.getByRole("button", { name: /Alpha/ });
    const beta = screen.getByRole("button", { name: /Beta/ });
    expect(screen.getByRole("button", { name: /Google Scholar/ })).toBeTruthy();
    expect(alpha.getAttribute("aria-pressed")).toBe("true");
    expect(beta.getAttribute("aria-pressed")).toBe("false");

    await user.click(beta);
    await user.click(alpha);

    expect(beta.getAttribute("aria-pressed")).toBe("true");
    expect(alpha.getAttribute("aria-pressed")).toBe("false");
  });

  it("requests a topic brief and renders the answer with citations", async () => {
    const user = userEvent.setup();
    const matchedPaper = {
      ...paper,
      id: "ev-1",
      title: "Information technology fundamentals",
      url: "https://example.org/it",
      year: 2023,
      doi: "10.1/it",
      abstract: "A study of IT fundamentals.",
    };
    vi.mocked(runMentoSearch).mockResolvedValue({ results: [matchedPaper], failedSources: [], succeededCount: 1 });
    const { container } = render(<MentoSearchPage />);
    await search(user);
    await user.click(await screen.findByRole("tab", { name: /Answer/ }));

    expect(await screen.findByText("IT Fundamentals")).toBeTruthy();
    expect(screen.getByText(/Information technology covers hardware/)).toBeTruthy();
    expect(screen.getByText("Partial evidence")).toBeTruthy();
    expect(screen.getByText("General knowledge")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Show evidence 1" }).length,
    ).toBeGreaterThan(0);
    expect(
      new URL(screen.getByRole("link", { name: "Verify on Google Scholar" }).getAttribute("href")!).searchParams.get("q"),
    ).toBe("Information technology fundamentals");
    expect(new URL(screen.getByRole("link", { name: "Open in Google Scholar" }).getAttribute("href")!).searchParams.get("q"))
      .toBe("IT fundamentals");

    expect(searchBrief).toHaveBeenCalledTimes(1);
    const [query, sources, sort, signal] = vi.mocked(searchBrief).mock.calls[0];
    expect(query).toBe("IT fundamentals");
    expect(sources).toEqual(["alpha"]);
    expect(sort).toBe("relevance");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(vi.mocked(searchBrief).mock.calls[0][7]).toEqual([matchedPaper]);
    expect(screen.getByRole("button", { name: "Copy citation" })).toBeTruthy();
    expect(container.querySelector(".citation-block p")?.textContent).toContain("Ada Lovelace, Grace Hopper (2023)");
  });

  it("highlights the evidence card when a citation is clicked", async () => {
    const user = userEvent.setup();
    render(<MentoSearchPage />);
    await search(user);
    await user.click(await screen.findByRole("tab", { name: /Answer/ }));

    await user.click(
      (
        await screen.findAllByRole("button", { name: "Show evidence 1" })
      )[0],
    );

    const card = document.getElementById("evidence-ev-1");
    expect(card?.className).toContain("active");
  });

  it("shows the evidence-only fallback banner", async () => {
    const user = userEvent.setup();
    vi.mocked(searchBrief).mockResolvedValue({
      ...briefResponse,
      support: "evidence-only",
    });
    render(<MentoSearchPage />);
    await search(user);
    await user.click(await screen.findByRole("tab", { name: /Answer/ }));

    expect(
      await screen.findByText(/AI overview was unavailable/),
    ).toBeTruthy();
    expect(screen.getByText("Sources only")).toBeTruthy();
  });

  it("warns when no papers were retrieved for a general overview", async () => {
    const user = userEvent.setup();
    vi.mocked(searchBrief).mockResolvedValue({
      ...briefResponse,
      support: "general",
      evidence: [],
      brief: {
        ...briefResponse.brief,
        overview_evidence_ids: [],
        sections: [
          {
            heading: "Core areas",
            points: [{ text: "Hardware is physical.", evidence_ids: [] }],
          },
        ],
      },
    });
    render(<MentoSearchPage />);
    await search(user);
    await user.click(await screen.findByRole("tab", { name: /Answer/ }));

    expect(await screen.findByText(/No matching papers were found/)).toBeTruthy();
  });

  it("shows a cached-result notice", async () => {
    const user = userEvent.setup();
    vi.mocked(searchBrief).mockResolvedValue({
      ...briefResponse,
      cached: true,
    });
    render(<MentoSearchPage />);
    await search(user);
    await user.click(await screen.findByRole("tab", { name: /Answer/ }));

    expect(
      await screen.findByText("Cached answer from a recent search."),
    ).toBeTruthy();
  });

  it("shows the API error when the brief fails", async () => {
    const user = userEvent.setup();
    vi.mocked(searchBrief).mockRejectedValue(
      new Error("Search sources are unavailable right now."),
    );
    render(<MentoSearchPage />);
    await search(user);
    await user.click(await screen.findByRole("tab", { name: /Answer/ }));

    expect(
      await screen.findByText("Search sources are unavailable right now."),
    ).toBeTruthy();
  });

  it("loads the paper list immediately and independently of the Answer tab", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [paper],
      failedSources: [],
      succeededCount: 1,
    });
    render(<MentoSearchPage />);
    await search(user);

    expect(
      await screen.findByRole("link", { name: /Spaced repetition helps long-term recall/ }),
    ).toBeTruthy();
    expect(screen.getByText(/1 paper for/)).toBeTruthy();
    expect(screen.getByText(/DOI: 10.1\/example/)).toBeTruthy();
    expect(runMentoSearch).toHaveBeenCalledTimes(1);
    const [query, sources] = vi.mocked(runMentoSearch).mock.calls[0];
    expect(query).toBe("IT fundamentals");
    expect([...sources]).toEqual(["alpha"]);
  });

  it("hides partial provider failures when another source returned papers", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [paper],
      failedSources: ["Google Scholar", "Semantic Scholar"],
      sourceMessages: ["This source is unavailable right now."],
      succeededCount: 1,
    });
    render(<MentoSearchPage />);
    await search(user);

    await screen.findByRole("link", { name: /Spaced repetition helps long-term recall/ });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a source error banner only when all sources fail without papers", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [],
      failedSources: ["Alpha"],
      sourceMessages: ["This source is unavailable right now."],
      succeededCount: 0,
    });
    render(<MentoSearchPage />);
    await search(user);

    expect((await screen.findByRole("status")).textContent).toBe("Alpha is unavailable right now.");
  });

  it("applies a since-year preset immediately to paper search", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({ results: [paper], failedSources: [], succeededCount: 1 });
    render(<MentoSearchPage />);
    await search(user);
    await user.click(await screen.findByRole("button", { name: `Since ${new Date().getFullYear() - 1}` }));
    const calls = vi.mocked(runMentoSearch).mock.calls;
    expect(calls[calls.length - 1][4]).toBe(new Date().getFullYear() - 1);
  });

  it("keeps Papers first and selected by default", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({ results: [paper], failedSources: [], succeededCount: 1 });
    render(<MentoSearchPage />);
    await search(user);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0].textContent).toContain("Papers");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].textContent).toContain("Answer");
  });

  it("does not issue a request when a year preset is selected with an empty query", async () => {
    const user = userEvent.setup();
    render(<MentoSearchPage />);
    await user.click(screen.getByRole("button", { name: "Since 2023" }));
    expect(runMentoSearch).not.toHaveBeenCalled();
    expect(searchBrief).not.toHaveBeenCalled();
  });

  it("applies a custom year range and syncs it to Google Scholar links", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({ results: [paper], failedSources: [], succeededCount: 1 });
    render(<MentoSearchPage />);
    await search(user);
    await user.click(screen.getByRole("button", { name: "Custom range ▾" }));
    await user.type(screen.getByRole("textbox", { name: "From year" }), "2020");
    await user.type(screen.getByRole("textbox", { name: "To year" }), "2025");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    const calls = vi.mocked(runMentoSearch).mock.calls;
    expect(calls[calls.length - 1][4]).toBe(2020);
    expect(calls[calls.length - 1][5]).toBe(2025);
    const scholarLink = await screen.findByRole("link", { name: "Open in Google Scholar" });
    const params = new URL(scholarLink.getAttribute("href")!).searchParams;
    expect(params.get("as_ylo")).toBe("2020");
    expect(params.get("as_yhi")).toBe("2025");
  });

  it("clears a prior query before changing filters without reusing its stale search", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({ results: [paper], failedSources: [], succeededCount: 1 });
    render(<MentoSearchPage />);
    await search(user);
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    const callsBeforeFilter = vi.mocked(runMentoSearch).mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Since 2023" }));
    expect(runMentoSearch).toHaveBeenCalledTimes(callsBeforeFilter);
  });

  it("shows citation style controls and formatted citations on paper cards", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({ results: [paper], failedSources: [], succeededCount: 1 });
    render(<MentoSearchPage />);
    await search(user);
    expect((await screen.findByRole("list")).textContent).toContain("Ada Lovelace, Grace Hopper (2020)");
    expect(screen.getByRole("button", { name: "Copy citation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy all citations" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Citation style" })).toBeTruthy();
  });

  it("orders papers newest first when the newest sort is selected", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [
        paper,
        {
          ...paper,
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
    await user.click(screen.getByRole("button", { name: /Advanced sources/ }));
    await user.click(screen.getByRole("button", { name: "Newest" }));
    await search(user);
    await screen.findByRole("link", { name: /Interleaving practice beats blocking/ });
    const titles = Array.from(container.querySelectorAll(".result-title")).map(
      (node) => node.textContent?.trim(),
    );
    expect(titles[0]).toContain("Interleaving practice beats blocking");
    expect(titles[1]).toContain("Spaced repetition helps long-term recall");
  });

  it("warns when a paper source is unavailable", async () => {
    const user = userEvent.setup();
    vi.mocked(runMentoSearch).mockResolvedValue({
      results: [],
      failedSources: ["Alpha"],
      succeededCount: 0,
    });
    render(<MentoSearchPage />);
    await search(user);
    expect(
      await screen.findByText(/Alpha is unavailable right now/),
    ).toBeTruthy();
    expect(screen.getByText(/selected sources are unavailable/)).toBeTruthy();
  });

  it("disables the submit button until a query is entered", async () => {
    const user = userEvent.setup();
    render(<MentoSearchPage />);

    const submit = screen.getByRole("button", {
      name: "Search",
    }) as HTMLButtonElement;
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

    await user.click(screen.getByRole("button", { name: /Advanced sources/ }));
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("button", { name: "Newest" }));

    expect(
      JSON.parse(localStorage.getItem("mentosearch-preferences:v2") || "{}"),
    ).toEqual({ sources: ["alpha", "beta"], sort: "newest" });
  });

  it("asks the user to enable a source when none are selected", async () => {
    const user = userEvent.setup();
    render(<MentoSearchPage />);

    await user.click(screen.getByRole("button", { name: /Advanced sources/ }));
    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    await search(user);
    expect(
      screen.getByText("Enable at least one trusted source to search."),
    ).toBeTruthy();
    expect(searchBrief).not.toHaveBeenCalled();
  });
});
