import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMentoSearch } from "./searchProviders";

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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/search/semantic")) return jsonResponse(semanticPayload);
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
      "openalex-https://openalex.org/W1",
      "crossref-10.1/unique",
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
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("filter")).toBe("from-pub-date:2020-01-01,until-pub-date:2022-12-31");
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
      id: "europepmc-MED-123456",
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
      expect.stringContaining(
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
      ),
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
