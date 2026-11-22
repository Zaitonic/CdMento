// MentoSearch source providers.
// Crossref, OpenAlex, PubMed, and Europe PMC expose CORS-friendly public APIs
// and are called directly from the browser. Semantic Scholar and arXiv do not
// send CORS headers, so they go through the authenticated /api/v1/search proxy.
// Google Scholar has no public API and blocks cross-origin browser requests,
// so it is offered as a direct "Open in Google Scholar" link instead.

import { authHeaders } from "../../lib/api";

export interface MentoResult {
  id: string;
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  authors: string[];
  abstract?: string;
  year?: number;
  venue?: string;
  citations?: number;
  doi?: string;
  rank: number;
}

export interface SourceConfig {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  search: (query: string, signal: AbortSignal, timeoutMs?: number) => Promise<MentoResult[]>;
}

const clean = (value: string | undefined | null): string =>
  (value || "").replace(/\s+/g, " ").trim();

function stripTags(value: string): string {
  return clean(value.replace(/<[^>]*>/g, " "));
}

/** Semantic Scholar — academic graph, closest public analogue to Google Scholar. */
async function searchSemanticScholar(
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<MentoResult[]> {
  const url =
    "/api/v1/search/semantic?query=" + encodeURIComponent(query);
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const response = await fetch(url, { signal: combinedSignal, headers: authHeaders() });
  if (!response.ok) throw new Error(`Semantic Scholar responded ${response.status}`);
  const data = await response.json();
  const items: any[] = data?.data || [];
  return items.map((paper, index) => ({
    id: `s2-${paper.paperId || index}`,
    title: clean(paper.title) || "Untitled",
    url:
      paper.url ||
      "https://www.semanticscholar.org/search?q=" +
        encodeURIComponent(paper.title || query),
    sourceId: "semantic",
    sourceName: "Semantic Scholar",
    authors: (paper.authors || [])
      .map((author: any) => clean(author?.name))
      .filter(Boolean),
    abstract: clean(paper.abstract) || undefined,
    year: typeof paper.year === "number" ? paper.year : undefined,
    venue: clean(paper.venue) || undefined,
    citations:
      typeof paper.citationCount === "number" ? paper.citationCount : undefined,
    doi: paper.externalIds?.DOI || undefined,
    rank: index,
  }));
}

/** arXiv — open-access preprints (physics, CS, math, etc.). Returns Atom XML. */
async function searchArxiv(
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<MentoResult[]> {
  const url = "/api/v1/search/arxiv?query=" + encodeURIComponent(query);
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const response = await fetch(url, { signal: combinedSignal, headers: authHeaders() });
  if (!response.ok) throw new Error(`arXiv responded ${response.status}`);
  const xml = await response.text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const entries = Array.from(doc.getElementsByTagName("entry"));
  return entries.map((entry, index) => {
    const text = (tag: string) =>
      clean(entry.getElementsByTagName(tag)[0]?.textContent ?? "");
    const id = text("id");
    const published = text("published");
    return {
      id: `arxiv-${id || index}`,
      title: text("title") || "Untitled",
      url: id || `https://arxiv.org/abs/${index}`,
      sourceId: "arxiv",
      sourceName: "arXiv",
      authors: Array.from(entry.getElementsByTagName("author"))
        .map((author) => clean(author.getElementsByTagName("name")[0]?.textContent ?? ""))
        .filter(Boolean),
      abstract: text("summary") || undefined,
      year: published ? Number(published.slice(0, 4)) : undefined,
      rank: index,
    };
  });
}

/** PubMed — biomedical literature via NCBI E-utilities (esearch + esummary). */
async function searchPubMed(
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<MentoResult[]> {
  const searchUrl =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=15&term=" +
    encodeURIComponent(query);
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const searchResponse = await fetch(searchUrl, { signal: combinedSignal });
  if (!searchResponse.ok)
    throw new Error(`PubMed responded ${searchResponse.status}`);
  const searchData = await searchResponse.json();
  const ids: string[] = searchData?.esearchresult?.idlist || [];
  if (!ids.length) return [];

  const summaryUrl =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=" +
    ids.join(",");
  const summaryResponse = await fetch(summaryUrl, { signal: combinedSignal });
  if (!summaryResponse.ok)
    throw new Error(`PubMed responded ${summaryResponse.status}`);
  const summaryData = await summaryResponse.json();

  const results: MentoResult[] = [];
  ids.forEach((id, index) => {
    const item = summaryData?.result?.[id];
    if (!item) return;
    const doi = (item.articleids || []).find(
      (entry: any) => entry?.idtype === "doi",
    )?.value;
    results.push({
      id: `pubmed-${id}`,
      title: clean(item.title) || "Untitled",
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      sourceId: "pubmed",
      sourceName: "PubMed",
      authors: (item.authors || [])
        .map((author: any) => clean(author?.name))
        .filter(Boolean),
      year: item.pubdate ? Number(String(item.pubdate).slice(0, 4)) : undefined,
      venue: clean(item.fulljournalname) || undefined,
      doi: doi || undefined,
      rank: index,
    });
  });
  return results;
}

/** Europe PMC — open index of life-science literature and preprints. */
async function searchEuropePMC(
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<MentoResult[]> {
  const url =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=15&query=" +
    encodeURIComponent(query);
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const response = await fetch(url, { signal: combinedSignal });
  if (!response.ok) throw new Error(`Europe PMC responded ${response.status}`);
  const data = await response.json();
  const items: any[] = data?.resultList?.result || [];
  return items.map((item, index) => {
    const authors = clean(item.authorString)
      .split(/[,;]\s*/)
      .map(clean)
      .filter(Boolean);
    return {
      id: `europepmc-${item.source || "SRC"}-${item.id || index}`,
      title: clean(item.title) || "Untitled",
      url:
        item.source && item.id
          ? `https://europepmc.org/article/${item.source}/${item.id}`
          : `https://europepmc.org/search?query=${encodeURIComponent(query)}`,
      sourceId: "europepmc",
      sourceName: "Europe PMC",
      authors,
      abstract: clean(item.abstractText) || undefined,
      year: item.pubYear ? Number(item.pubYear) : undefined,
      venue: clean(item.journalTitle) || undefined,
      citations:
        typeof item.citedByCount === "number" ? item.citedByCount : undefined,
      doi: item.doi || undefined,
      rank: index,
    };
  });
}

/** Crossref — broad scholarly metadata across publishers. */
async function searchCrossref(
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<MentoResult[]> {
  const url =
    "https://api.crossref.org/works?rows=15&select=title,author,abstract,DOI,URL,is-referenced-by-count,published-print,published-online,container-title&query=" +
    encodeURIComponent(query);
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const response = await fetch(url, { signal: combinedSignal });
  if (!response.ok) throw new Error(`Crossref responded ${response.status}`);
  const data = await response.json();
  const items: any[] = data?.message?.items || [];
  return items.map((work, index) => {
    const published =
      work.published?.["date-parts"]?.[0]?.[0] ??
      work["published-print"]?.["date-parts"]?.[0]?.[0] ??
      work["published-online"]?.["date-parts"]?.[0]?.[0];
    return {
      id: `crossref-${work.DOI || index}`,
      title: clean(work.title?.[0]) || "Untitled",
      url: work.URL || `https://doi.org/${work.DOI}`,
      sourceId: "crossref",
      sourceName: "Crossref",
      authors: (work.author || [])
        .map((author: any) =>
          clean([author?.given, author?.family].filter(Boolean).join(" ")),
        )
        .filter(Boolean),
      abstract: work.abstract ? stripTags(work.abstract) || undefined : undefined,
      year: typeof published === "number" ? published : undefined,
      venue: clean(work["container-title"]?.[0]) || undefined,
      citations:
        typeof work["is-referenced-by-count"] === "number"
          ? work["is-referenced-by-count"]
          : undefined,
      doi: work.DOI || undefined,
      rank: index,
    };
  });
}

/** OpenAlex — open scholarly index; rebuilds abstracts from inverted index. */
function reconstructAbstract(
  inverted: Record<string, number[]> | null | undefined,
): string | undefined {
  if (!inverted) return undefined;
  const words: { position: number; word: string }[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const position of positions) words.push({ position, word });
  }
  if (!words.length) return undefined;
  words.sort((a, b) => a.position - b.position);
  return clean(words.map((entry) => entry.word).join(" "));
}

async function searchOpenAlex(
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<MentoResult[]> {
  const url =
    "https://api.openalex.org/works?per-page=15&search=" + encodeURIComponent(query);
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const response = await fetch(url, { signal: combinedSignal });
  if (!response.ok) throw new Error(`OpenAlex responded ${response.status}`);
  const data = await response.json();
  const items: any[] = data?.results || [];
  return items.map((work, index) => ({
    id: `openalex-${work.id || index}`,
    title: clean(work.display_name) || "Untitled",
    url:
      work.primary_location?.landing_page_url ||
      work.doi ||
      work.id ||
      `https://openalex.org/search?q=${encodeURIComponent(query)}`,
    sourceId: "openalex",
    sourceName: "OpenAlex",
    authors: (work.authorships || [])
      .map((authorship: any) => clean(authorship?.author?.display_name))
      .filter(Boolean),
    abstract: reconstructAbstract(work.abstract_inverted_index),
    year:
      typeof work.publication_year === "number"
        ? work.publication_year
        : undefined,
    venue: clean(work.primary_location?.source?.display_name) || undefined,
    citations:
      typeof work.cited_by_count === "number" ? work.cited_by_count : undefined,
    doi: (work.doi || "").replace(/^https?:\/\/doi\.org\//, "") || undefined,
    rank: index,
  }));
}

export const SOURCES: SourceConfig[] = [
  {
    id: "semantic",
    name: "Semantic Scholar",
    description: "Academic papers with citations (needs an API key for reliable access)",
    defaultEnabled: false,
    search: searchSemanticScholar,
  },
  {
    id: "crossref",
    name: "Crossref",
    description: "Scholarly metadata across publishers",
    defaultEnabled: true,
    search: searchCrossref,
  },
  {
    id: "openalex",
    name: "OpenAlex",
    description: "Open catalogue of scholarly works",
    defaultEnabled: true,
    search: searchOpenAlex,
  },
  {
    id: "arxiv",
    name: "arXiv",
    description: "Open-access preprints",
    defaultEnabled: false,
    search: searchArxiv,
  },
  {
    id: "pubmed",
    name: "PubMed",
    description: "Biomedical and life-science literature",
    defaultEnabled: false,
    search: searchPubMed,
  },
  {
    id: "europepmc",
    name: "Europe PMC",
    description: "Life-science literature and preprints",
    defaultEnabled: true,
    search: searchEuropePMC,
  },
];

export interface SearchOutcome {
  results: MentoResult[];
  failedSources: string[];
  succeededCount: number;
}

function dedupeKey(result: MentoResult): string {
  if (result.doi) return `doi:${result.doi.toLowerCase()}`;
  return `title:${result.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** Interleave results by rank so the top hits from each source surface first. */
function interleave(groups: MentoResult[][]): MentoResult[] {
  const merged: MentoResult[] = [];
  const maxLength = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let index = 0; index < maxLength; index += 1) {
    for (const group of groups) {
      if (group[index]) merged.push(group[index]);
    }
  }
  return merged;
}

export async function runMentoSearch(
  query: string,
  enabledIds: Set<string>,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<SearchOutcome> {
  const active = SOURCES.filter((source) => enabledIds.has(source.id));
  if (!active.length) {
    throw new Error("Enable at least one trusted source to search.");
  }
  const settled = await Promise.allSettled(
    active.map((source) => source.search(query, signal, timeoutMs)),
  );
  const failedSources: string[] = [];
  const groups: MentoResult[][] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      if (outcome.value.length) groups.push(outcome.value);
    } else {
      failedSources.push(active[index].name);
    }
  });
  const succeededCount = settled.length - failedSources.length;
  const seen = new Set<string>();
  const unique: MentoResult[] = [];
  for (const result of interleave(groups)) {
    const key = dedupeKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return { results: unique, failedSources, succeededCount };
}
