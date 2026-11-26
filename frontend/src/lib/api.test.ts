import { afterEach, describe, expect, it, vi } from "vitest";
import { searchBrief } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("searchBrief request serialization", () => {
  it("sends all supported source IDs and clamps paper fields to the API schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sources = [
      "semantic", "crossref", "openalex", "europepmc", "arxiv", "pubmed",
      "google_scholar",
    ];

    await searchBrief("IT fundamentals", sources, "relevance", undefined, undefined, 2023, 2024, [{
      id: "paper-1",
      sourceId: "google_scholar",
      title: "IT fundamentals",
      authors: ["Ada Lovelace"],
      year: 2023,
      venue: "Journal of IT",
      doi: "10.1/it",
      url: "https://example.org/it",
      abstract: "x".repeat(4000),
      citations: 12,
    }]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.sources).toEqual(sources);
    expect(body.year_from).toBe(2023);
    expect(body.year_to).toBe(2024);
    expect(body.papers[0].source).toBe("google_scholar");
    expect(body.papers[0].abstract).toHaveLength(3000);
  });
});
