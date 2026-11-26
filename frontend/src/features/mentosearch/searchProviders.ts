// MentoSearch source providers.
// Crossref, OpenAlex, PubMed, and Europe PMC expose CORS-friendly public APIs
// and are called directly from the browser. Semantic Scholar and arXiv do not
// send CORS headers, so they go through the authenticated /api/v1/search proxy.
// Google Scholar has no public API and blocks cross-origin browser requests,
// so it is offered as a direct "Open in Google Scholar" link instead.

import { api, ApiError, authHeaders } from "../../lib/api";

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
  search: (query: string, signal: AbortSignal, timeoutMs?: number, yearFrom?: number, yearTo?: number, sort?: "relevance" | "newest") => Promise<MentoResult[]>;
}

export interface YearRange { yearFrom?: number; yearTo?: number }

const clean = (value: string | undefined | null): string =>
  (value || "").replace(/\s+/g, " ").trim();

async function fetchYearAware(url: string, fallbackUrl: string, signal: AbortSignal, hasYearFilter: boolean) {
  let response = await fetch(url, { signal });
  if (hasYearFilter && (response.status === 400 || response.status === 422)) {
    response = await fetch(fallbackUrl, { signal });
  }
  if (!response.ok) throw new Error(`Search provider responded ${response.status}`);
  return response;
}

async function searchServerSource(
  sourceId: string,
  sourceName: string,
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
  yearFrom?: number,
  yearTo?: number,
  sort: "relevance" | "newest" = "relevance",
  fallback?: SourceConfig["search"],
): Promise<MentoResult[]> {
  const params = new URLSearchParams({ q: query, sort });
  if (yearFrom !== undefined) params.set("year_from", String(yearFrom));
  if (yearTo !== undefined) params.set("year_to", String(yearTo));
  try {
    const result = await api<{ data: MentoResult[] }>(`/search/${sourceId}?${params}`, { signal }, timeoutMs);
    return result.data || [];
  } catch (error) {
    if (!fallback || signal.aborted || (error instanceof ApiError && error.status < 500)) throw error;
    return fallback(query, signal, timeoutMs, yearFrom, yearTo);
  }
}

function stripTags(value: string): string {
  return clean(value.replace(/<[^>]*>/g, " "));
}

/** Semantic Scholar — academic graph, closest public analogue to Google Scholar. */
async function searchSemanticScholar(
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
  yearFrom?: number,
  yearTo?: number,
): Promise<MentoResult[]> {
  const params = new URLSearchParams();
  if (yearFrom) params.set("year_from", String(yearFrom));
  if (yearTo) params.set("year_to", String(yearTo));
  const url = "/api/v1/search/semantic?query=" + encodeURIComponent(query) + (params.size ? `&${params}` : "");
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
  yearFrom?: number,
  yearTo?: number,
): Promise<MentoResult[]> {
  const params = new URLSearchParams();
  if (yearFrom) params.set("year_from", String(yearFrom));
  if (yearTo) params.set("year_to", String(yearTo));
  const url = "/api/v1/search/arxiv?query=" + encodeURIComponent(query) + (params.size ? `&${params}` : "");
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
  yearFrom?: number,
  yearTo?: number,
): Promise<MentoResult[]> {
  const makeSearchUrl = (filtered: boolean) => {
    const term = filtered && (yearFrom || yearTo)
      ? `(${query}) AND (${yearFrom || 1900}[Date - Publication] : ${yearTo || 2200}[Date - Publication])`
      : query;
    return "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=15&term=" + encodeURIComponent(term);
  };
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const searchResponse = await fetchYearAware(makeSearchUrl(true), makeSearchUrl(false), combinedSignal, Boolean(yearFrom || yearTo));
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
  yearFrom?: number,
  yearTo?: number,
): Promise<MentoResult[]> {
  const makeUrl = (term: string) =>
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=15&query=" + encodeURIComponent(term);
  const filteredQuery = yearFrom || yearTo ? `(${query}) AND PUB_YEAR:[${yearFrom || '*'} TO ${yearTo || '*'}]` : query;
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const response = await fetchYearAware(makeUrl(filteredQuery), makeUrl(query), combinedSignal, Boolean(yearFrom || yearTo));
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
  yearFrom?: number,
  yearTo?: number,
): Promise<MentoResult[]> {
  const makeUrl = (filtered: boolean) => {
    const params = new URLSearchParams({ rows: "15", select: "title,author,abstract,DOI,URL,is-referenced-by-count,published-print,published-online,container-title", query });
    const dateFilters = [filtered && yearFrom ? `from-pub-date:${yearFrom}-01-01` : "", filtered && yearTo ? `until-pub-date:${yearTo}-12-31` : ""].filter(Boolean);
    if (dateFilters.length) params.set("filter", dateFilters.join(","));
    return "https://api.crossref.org/works?" + params;
  };
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const response = await fetchYearAware(makeUrl(true), makeUrl(false), combinedSignal, Boolean(yearFrom || yearTo));
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
  yearFrom?: number,
  yearTo?: number,
): Promise<MentoResult[]> {
  const makeUrl = (filtered: boolean) => {
    const params = new URLSearchParams({ "per-page": "15", search: query });
    const yearFilters = [filtered && yearFrom ? `from_publication_date:${yearFrom}-01-01` : "", filtered && yearTo ? `to_publication_date:${yearTo}-12-31` : ""].filter(Boolean);
    if (yearFilters.length) params.set("filter", yearFilters.join(","));
    return "https://api.openalex.org/works?" + params;
  };
  const timeout = timeoutMs ? new AbortController() : null;
  const timer = timeout ? setTimeout(() => timeout.abort(), timeoutMs) : null;
  const combinedSignal = timeout
    ? signal
      ? AbortSignal.any([signal, timeout.signal])
      : timeout.signal
    : signal;
  const response = await fetchYearAware(makeUrl(true), makeUrl(false), combinedSignal, Boolean(yearFrom || yearTo));
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
    id: "google_scholar",
    name: "Google Scholar",
    description: "Searches Google Scholar through a server-side SerpApi or Serper key",
    defaultEnabled: false,
    search: searchGoogleScholar,
  },
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
    search: (query, signal, timeout, from, to, sort) => searchServerSource("crossref", "Crossref", query, signal, timeout, from, to, sort, searchCrossref),
  },
  {
    id: "openalex",
    name: "OpenAlex",
    description: "Open catalogue of scholarly works",
    defaultEnabled: true,
    search: (query, signal, timeout, from, to, sort) => searchServerSource("openalex", "OpenAlex", query, signal, timeout, from, to, sort, searchOpenAlex),
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
    search: (query, signal, timeout, from, to, sort) => searchServerSource("pubmed", "PubMed", query, signal, timeout, from, to, sort, searchPubMed),
  },
  {
    id: "europepmc",
    name: "Europe PMC",
    description: "Life-science literature and preprints",
    defaultEnabled: true,
    search: (query, signal, timeout, from, to, sort) => searchServerSource("europepmc", "Europe PMC", query, signal, timeout, from, to, sort, searchEuropePMC),
  },
];

export interface SearchOutcome {
  results: MentoResult[];
  failedSources: string[];
  succeededCount: number;
  sourceMessages?: string[];
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
  yearFrom?: number,
  yearTo?: number,
  sort: "relevance" | "newest" = "relevance",
): Promise<SearchOutcome> {
  const active = SOURCES.filter((source) => enabledIds.has(source.id));
  if (!active.length) {
    throw new Error("Enable at least one trusted source to search.");
  }
  const settled = await Promise.allSettled(
    active.map((source) => source.search(
      query.trim().toLocaleLowerCase() === "it" ? "information technology" : query,
      signal,
      timeoutMs,
      yearFrom,
      yearTo,
      sort,
    )),
  );
  const failedSources: string[] = [];
  const sourceMessages: string[] = [];
  const groups: MentoResult[][] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      if (outcome.value.length) groups.push(outcome.value);
    } else {
      failedSources.push(active[index].name);
      if (active[index].id === "google_scholar" && outcome.reason instanceof Error) {
        sourceMessages.push(outcome.reason.message);
      }
    }
  });
  const succeededCount = settled.length - failedSources.length;
  const seen = new Set<string>();
  const unique: MentoResult[] = [];
  for (const result of interleave(groups).filter((result) =>
    (yearFrom === undefined || (result.year !== undefined && result.year >= yearFrom)) &&
    (yearTo === undefined || (result.year !== undefined && result.year <= yearTo)),
  )) {
    const key = dedupeKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return { results: unique, failedSources, succeededCount, sourceMessages };
}

async function searchGoogleScholar(
  query: string,
  signal: AbortSignal,
  timeoutMs?: number,
  yearFrom?: number,
  yearTo?: number,
  sort: "relevance" | "newest" = "relevance",
): Promise<MentoResult[]> {
  const params = new URLSearchParams({ q: query, sort });
  if (yearFrom !== undefined) params.set("year_from", String(yearFrom));
  if (yearTo !== undefined) params.set("year_to", String(yearTo));
  const result = await api<{ data: Array<Record<string, unknown>> }>(
    `/search/google_scholar?${params}`,
    { signal },
    timeoutMs,
  );
  return (result.data || []).map((item, index) => ({
    id: String(item.id || `google-scholar-${index}`),
    title: clean(String(item.title || "")) || "Untitled",
    url: String(item.url || "https://scholar.google.com/"),
    sourceId: "google_scholar",
    sourceName: "Google Scholar",
    authors: Array.isArray(item.authors) ? item.authors.map(String) : [],
    abstract: clean(String(item.abstract || "")) || undefined,
    year: typeof item.year === "number" ? item.year : undefined,
    venue: clean(String(item.venue || "")) || undefined,
    citations: typeof item.citations === "number" ? item.citations : undefined,
    doi: typeof item.doi === "string" ? item.doi : undefined,
    rank: index,
  }));
}
