import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMentoSearch, SOURCES } from "./searchProviders";

const semanticPayload = {
  data: [
    {
      paperId: "p1",
      title: "Spaced repetition improves retention",
      authors: [{ name: "Ada Lovelace" }],
      year: 2020,
      abstract: "A randomised study.",
      venue: "Journal of Learning",
      citationCount: 42,
      externalIds: { DOI: "10.1/DUP" },
      url: "https://www.semanticscholar.org/paper/p1",
    },
  ],
};

const crossrefPayload = {
  message: {
    items: [
      {
        title: ["Spaced repetition improves retention"],
        DOI: "10.1/DUP",
        URL: "https://doi.org/10.1/dup",
        author: [{ given: "Ada", family: "Lovelace" }],
        "is-referenced-by-count": 5,
        "published-print": { "date-parts": [[2021]] },
        "container-title": ["Journal of Learning"],
      },
      {
        title: ["Interleaving practice beats blocking"],
        DOI: "10.1/unique",
        URL: "https://doi.org/10.1/unique",
        abstract: "<jats:p>Second result</jats:p>",
        author: [],
        "is-referenced-by-count": 1,
        "published-online": { "date-parts": [[2019]] },
      },
    ],
  },
};

const openAlexPayload = {
  results: [
    {
      id: "https://openalex.org/W1",
      display_name: "Interleaving and spacing",
      authorships: [{ author: { display_name: "Grace Hopper" } }],
      publication_year: 2022,
      cited_by_count: 7,
      doi: "https://doi.org/10.9/oa",
      primary_location: {
        landing_page_url: "https://openalex.org/W1",
        source: { display_name: "Open Journal" },
      },
      abstract_inverted_index: {
        retrieval: [0],
        Spaced: [1],
        helps: [2],
      },
    },
  ],
};

const europePmcPayload = {
  resultList: {
    result: [
      {
        id: "123456",
        source: "MED",
        title: "Spaced repetition improves long-term retention",
        authorString: "Lovelace A, Hopper G",
        pubYear: "2020",
        journalTitle: "Journal of Learning",
        abstractText: "A controlled study.",
        citedByCount: 9,
        doi: "10.1/epmc",
      },
    ],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/search/google_scholar")) return jsonResponse({ data: [{
      id: "google-1", title: "IT fundamentals", url: "https://example.org/it",
      authors: ["Ada Lovelace"], year: 2023, venue: "Journal of IT", citations: 5,
    }] });
    if (url.includes("/api/v1/search/semantic")) return jsonResponse(semanticPayload);
    if (url.includes("/api/v1/search/crossref")) return jsonResponse({ data: [
      { id: "crossref-ev-1", title: "Spaced repetition improves retention", url: "https://doi.org/10.1/dup", sourceId: "crossref", sourceName: "Crossref", authors: ["Ada Lovelace"], year: 2021, doi: "10.1/DUP", rank: 0 },
      { id: "crossref-ev-2", title: "Interleaving practice beats blocking", url: "https://doi.org/10.1/unique", sourceId: "crossref", sourceName: "Crossref", authors: [], year: 2019, abstract: "Second result", rank: 1 },
    ] });
    if (url.includes("/api/v1/search/openalex")) return jsonResponse({ data: [{
      id: "openalex-ev-1", title: "Interleaving and spacing", url: "https://openalex.org/W1", sourceId: "openalex", sourceName: "OpenAlex", authors: ["Grace Hopper"], year: 2022, citations: 7, doi: "10.9/oa", abstract: "retrieval Spaced helps", rank: 0,
    }] });
    if (url.includes("/api/v1/search/europepmc")) return jsonResponse({ data: [{
      id: "europepmc-ev-1", title: "Spaced repetition improves long-term retention", url: "https://europepmc.org/article/MED/123456", sourceId: "europepmc", sourceName: "Europe PMC", authors: ["Lovelace A", "Hopper G"], year: 2020, venue: "Journal of Learning", citations: 9, doi: "10.1/epmc", rank: 0,
    }] });
    if (url.includes("crossref.org")) return jsonResponse(crossrefPayload);
    if (url.includes("openalex.org")) return jsonResponse(openAlexPayload);
    if (url.includes("europepmc")) return jsonResponse(europePmcPayload);
    if (url.includes("/api/v1/search/arxiv")) {
      return new Response("<feed></feed>", { status: 200 });
    }
    if (url.includes("ncbi.nlm.nih.gov")) {
      return jsonResponse({ esearchresult: { idlist: [] } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MentoSearch providers", () => {
  it("enables the six reliable sources by default and leaves Semantic Scholar optional", () => {
    expect(SOURCES.filter((source) => source.defaultEnabled).map((source) => source.id)).toEqual([
      "google_scholar", "crossref", "openalex", "arxiv", "pubmed", "europepmc",
    ]);
    expect(SOURCES.find((source) => source.id === "semantic")?.defaultEnabled).toBe(false);
  });

  it("merges, deduplicates, and interleaves results from enabled sources", async () => {
    const outcome = await runMentoSearch(
      "spaced repetition",
      new Set(["semantic", "crossref", "openalex"]),
      new AbortController().signal,
    );

    expect(outcome.failedSources).toEqual([]);
    expect(outcome.succeededCount).toBe(3);
    expect(outcome.results.map((r) => r.id)).toEqual([
      "s2-p1",
      "openalex-ev-1",
      "crossref-ev-2",
    ]);
    expect(outcome.results[0].doi).toBe("10.1/DUP");
    expect(outcome.results[2].abstract).toBe("Second result");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/search/semantic?query=spaced%20repetition",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("sends native year bounds and defensively excludes out-of-range records", async () => {
    const { results } = await runMentoSearch(
      "spaced repetition", new Set(["crossref"]), new AbortController().signal, 30_000, 2020, 2022,
    );
    expect(results.map((paper) => paper.year)).toEqual([2021]);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "https://cdmento.test");
    expect(url.searchParams.get("year_from")).toBe("2020");
    expect(url.searchParams.get("year_to")).toBe("2022");
  });

  it("retries a rejected Crossref year filter without the filter and post-filters", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/search/crossref")) return jsonResponse({}, 503);
      if (url.includes("crossref.org") && url.includes("filter=")) return jsonResponse({}, 400);
      if (url.includes("crossref.org")) return jsonResponse(crossrefPayload);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const outcome = await runMentoSearch(
      "spaced repetition", new Set(["crossref"]), new AbortController().signal, 30_000, 2020, 2022,
    );
    expect(outcome.results.map((paper) => paper.year)).toEqual([2021]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("filter=");
    expect(String(fetchMock.mock.calls[2][0])).not.toContain("filter=");
  });

  it("maps the server-side Google Scholar provider and carries year bounds", async () => {
    const outcome = await runMentoSearch(
      "IT fundamentals", new Set(["google_scholar"]), new AbortController().signal, 30_000, 2020, 2024, "newest",
    );
    expect(outcome.results[0]).toMatchObject({
      id: "google-1", sourceId: "google_scholar", sourceName: "Google Scholar",
      authors: ["Ada Lovelace"], year: 2023, citations: 5,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("year_from=2020");
    expect(String(fetchMock.mock.calls[0][0])).toContain("year_to=2024");
    expect(String(fetchMock.mock.calls[0][0])).toContain("sort=newest");
  });

  it("keeps a clear setup note when Google Scholar has no server key", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("google_scholar")) return jsonResponse({
        error: "Google Scholar requires SERPAPI_API_KEY or SERPER_API_KEY",
        kind: "not_configured",
      }, 503);
      return jsonResponse({ data: [{
        id: "crossref-ev-1", title: "Information technology fundamentals", url: "https://doi.org/10.1/it",
        sourceId: "crossref", sourceName: "Crossref", authors: ["Ada Lovelace"], year: 2023,
        doi: "10.1/it", rank: 0,
      }] });
    });
    const outcome = await runMentoSearch(
      "information technology", new Set(["google_scholar", "crossref"]), new AbortController().signal,
    );
    expect(outcome.failedSources).toContain("Google Scholar");
    expect(outcome.sourceMessages).toContain("Google Scholar requires SERPAPI_API_KEY or SERPER_API_KEY");
    expect(outcome.results.length).toBeGreaterThan(0);
  });

  it("expands the exact short query 'it' before requesting sources", async () => {
    await runMentoSearch("it", new Set(["crossref"]), new AbortController().signal);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "https://cdmento.test");
    expect(url.searchParams.get("q")).toBe("information technology");
  });

  it("reconstructs OpenAlex abstracts and normalises DOIs", async () => {
    const { results } = await runMentoSearch(
      "spaced repetition",
      new Set(["openalex"]),
      new AbortController().signal,
    );

    expect(results).toHaveLength(1);
    expect(results[0].abstract).toBe("retrieval Spaced helps");
    expect(results[0].doi).toBe("10.9/oa");
    expect(results[0].citations).toBe(7);
    expect(results[0].sourceName).toBe("OpenAlex");
  });

  it("maps Europe PMC results with authors, DOI, and article links", async () => {
    const { results } = await runMentoSearch(
      "spaced repetition",
      new Set(["europepmc"]),
      new AbortController().signal,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "europepmc-ev-1",
      title: "Spaced repetition improves long-term retention",
      url: "https://europepmc.org/article/MED/123456",
      sourceId: "europepmc",
      sourceName: "Europe PMC",
      authors: ["Lovelace A", "Hopper G"],
      year: 2020,
      venue: "Journal of Learning",
      citations: 9,
      doi: "10.1/epmc",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/search/europepmc?"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("reports sources that fail without discarding successful ones", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("crossref.org")) return jsonResponse(crossrefPayload);
      throw new Error("network blocked");
    });

    const outcome = await runMentoSearch(
      "spaced repetition",
      new Set(["crossref", "arxiv"]),
      new AbortController().signal,
    );

    expect(outcome.failedSources).toEqual(["arXiv"]);
    expect(outcome.succeededCount).toBe(1);
    expect(outcome.results).toHaveLength(2);
  });

  it("passes the abort signal through to every provider request", async () => {
    const controller = new AbortController();
    await runMentoSearch("spaced repetition", new Set(["crossref"]), controller.signal);

    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBe(controller.signal);
  });

  it("refuses to search when no source is enabled", async () => {
    await expect(
      runMentoSearch("spaced repetition", new Set(), new AbortController().signal),
    ).rejects.toThrow("Enable at least one trusted source to search.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
