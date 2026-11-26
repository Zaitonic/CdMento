import { describe, expect, it } from "vitest";
import { formatCitation } from "./citation";

const paper = {
  id: "p1", title: "A useful paper.", url: "https://example.org/paper", sourceId: "x", sourceName: "X",
  authors: ["Ada Lovelace", "Grace Hopper"], year: 2024, venue: "Journal of Tests.", doi: "10.1234/test", rank: 0,
};

describe("citation formatting", () => {
  it("formats APA by default and resolves DOI links", () => {
    expect(formatCitation(paper).text).toBe("Ada Lovelace, Grace Hopper (2024). A useful paper. Journal of Tests. https://doi.org/10.1234/test.");
  });
  it("formats IEEE and MLA", () => {
    expect(formatCitation(paper, "IEEE").text).toContain("“A useful paper,” Journal of Tests, 2024.");
    expect(formatCitation(paper, "MLA").text).toContain("“A useful paper.” Journal of Tests, 2024.");
  });
  it("handles missing fields without None or broken punctuation", () => {
    const citation = formatCitation({ ...paper, authors: [], year: undefined, venue: undefined, doi: undefined, url: "" });
    expect(citation.text).toBe("Unknown author (n.d.). A useful paper.");
    expect(citation.text).not.toMatch(/None|\.\./);
  });
});
