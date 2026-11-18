"""Server-side retrieval for scholarly APIs.

Two jobs live here:

1. `ScholarSearch.fetch()` proxies sources that block browser CORS requests
   (Semantic Scholar and arXiv are used by the advanced MentoSearch list).
2. `ScholarSearch.evidence()` retrieves and normalizes records from every
   source for the AI topic brief. Upstream hosts are fixed and never taken
   from the request.
"""

import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import httpx

MAX_QUERY_LENGTH = 200
RETRIES = (429, 503)
ATTEMPTS = 3
USER_AGENT = "CdMento/1.0 (study workspace; scholarly search)"

MAX_EVIDENCE = 10
EVIDENCE_TIMEOUT = 10
ABSTRACT_LIMIT = 700
MAX_AUTHORS = 8

# Sources that can be queried for evidence. Order does not imply priority;
# results are ranked together after retrieval.
EVIDENCE_SOURCES = (
    "crossref",
    "openalex",
    "europepmc",
    "arxiv",
    "pubmed",
    "semantic",
)
DEFAULT_EVIDENCE_SOURCES = ("crossref", "openalex", "europepmc")

_PROVIDERS = {
    "semantic": (
        "https://api.semanticscholar.org/graph/v1/paper/search"
        "?limit=15&fields=title,abstract,authors,year,externalIds,url,citationCount,venue&query=",
        "application/json",
    ),
    "arxiv": (
        "https://export.arxiv.org/api/query"
        "?start=0&max_results=15&sortBy=relevance&search_query=all:",
        "application/xml",
    ),
}

_ATOM = {"a": "http://www.w3.org/2005/Atom"}
_ARXIV = {"x": "http://arxiv.org/schemas/atom"}

# Common study acronyms that scholarly indexes handle poorly as two letters.
# Expanding them turns "IT fundamentals" into "information technology
# fundamentals", which is what the indexes actually index.
_ACRONYMS = {
    "AI": "artificial intelligence",
    "API": "application programming interface",
    "CPU": "central processing unit",
    "CS": "computer science",
    "CSS": "cascading style sheets",
    "DB": "database",
    "DNS": "domain name system",
    "GPU": "graphics processing unit",
    "HDD": "hard disk drive",
    "HTML": "hypertext markup language",
    "HTTP": "hypertext transfer protocol",
    "IT": "information technology",
    "JSON": "javascript object notation",
    "LAN": "local area network",
    "ML": "machine learning",
    "OS": "operating system",
    "RAM": "random access memory",
    "SQL": "structured query language",
    "SSD": "solid state drive",
    "UI": "user interface",
    "UX": "user experience",
    "VPN": "virtual private network",
    "WAN": "wide area network",
    "XML": "extensible markup language",
}


def _expand_query(query):
    return re.sub(
        r"\b[A-Z][A-Z0-9]{1,4}\b",
        lambda match: _ACRONYMS.get(match.group(0), match.group(0)),
        query,
    )


def _clean_query(query):
    query = (query or "").strip()
    if not query:
        raise ValueError("Enter a topic to search.")
    if len(query) > MAX_QUERY_LENGTH:
        raise ValueError("Keep the search topic under 200 characters.")
    return query


def _clean_text(value):
    value = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", value).strip()


def _clean_doi(value):
    value = (value or "").strip()
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value, flags=re.I)
    return value


def _title_key(title):
    return re.sub(r"[^a-z0-9]+", "", title.lower())[:90]


def _record(
    source,
    title,
    url,
    authors=None,
    year=None,
    venue="",
    doi="",
    abstract="",
    citations=None,
):
    title = _clean_text(title)
    if not title:
        return None
    return {
        "id": "",
        "source": source,
        "title": title,
        "authors": [
            _clean_text(author)
            for author in (authors or [])
            if _clean_text(author)
        ][:MAX_AUTHORS],
        "year": year if isinstance(year, int) and 1900 <= year <= 2200 else None,
        "venue": _clean_text(venue),
        "doi": _clean_doi(doi),
        "url": url or "",
        "abstract": _clean_text(abstract)[:ABSTRACT_LIMIT],
        "citations": citations if isinstance(citations, int) and citations >= 0 else 0,
    }


def _year(value):
    match = re.search(r"(19|20|21)\d{2}", str(value or ""))
    return int(match.group(0)) if match else None


def _first(value):
    return value[0] if isinstance(value, list) and value else value


def _get(client, url, params=None, headers=None):
    """GET with one fast retry for burst throttling (429/503)."""
    merged = {"User-Agent": USER_AGENT, **(headers or {})}
    for attempt in range(2):
        try:
            response = client.get(url, params=params, headers=merged)
        except httpx.TransportError:
            if attempt:
                raise
            continue
        if response.status_code in (429, 503) and not attempt:
            time.sleep(1)
            continue
        response.raise_for_status()
        return response
    raise RuntimeError("Request retry failed.")


# --- Per-source retrival ----------------------------------------------------


def _fetch_crossref(client, query, api_key=""):
    response = _get(
        client,
        "https://api.crossref.org/works",
        params={
            "query.bibliographic": query,
            "rows": 15,
            "select": "DOI,title,author,issued,container-title,abstract,URL,is-referenced-by-count",
        },
    )
    response.raise_for_status()
    items = response.json().get("message", {}).get("items", [])
    records = []
    for item in items:
        authors = [
            " ".join(
                part
                for part in (author.get("given"), author.get("family"))
                if part
            )
            for author in item.get("author", [])
        ]
        issued = item.get("issued") or item.get("published") or {}
        date_parts = issued.get("date-parts") or [[None]]
        records.append(
            _record(
                "crossref",
                _first(item.get("title")),
                item.get("URL", ""),
                authors=authors,
                year=date_parts[0][0] if date_parts and date_parts[0] else None,
                venue=_first(item.get("container-title")),
                doi=item.get("DOI", ""),
                abstract=item.get("abstract", ""),
                citations=item.get("is-referenced-by-count"),
            )
        )
    return [r for r in records if r]


def _openalex_abstract(index):
    if not isinstance(index, dict):
        return ""
    words = []
    for word, places in index.items():
        if isinstance(places, list):
            words.extend((place, word) for place in places)
    words.sort()
    return " ".join(word for _, word in words)


def _fetch_openalex(client, query, api_key=""):
    response = _get(
        client,
        "https://api.openalex.org/works",
        params={"search": query, "per-page": 15},
    )
    response.raise_for_status()
    items = response.json().get("results", [])
    records = []
    for item in items:
        location = item.get("primary_location") or {}
        records.append(
            _record(
                "openalex",
                item.get("display_name"),
                location.get("landing_page_url")
                or (item.get("doi") or "").replace("https://doi.org/", "https://doi.org/"),
                authors=[
                    (authorship.get("author") or {}).get("display_name")
                    for authorship in item.get("authorships", [])
                ],
                year=item.get("publication_year"),
                venue=(location.get("source") or {}).get("display_name"),
                doi=item.get("doi", ""),
                abstract=_openalex_abstract(item.get("abstract_inverted_index")),
                citations=item.get("cited_by_count"),
            )
        )
    return [r for r in records if r]


def _fetch_europepmc(client, query, api_key=""):
    response = _get(
        client,
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
        params={
            "query": query,
            "format": "json",
            "resultType": "core",
            "pageSize": 15,
        },
    )
    response.raise_for_status()
    items = response.json().get("resultList", {}).get("result", [])
    records = []
    for item in items:
        authors = [
            _clean_text(author)
            for author in re.split(r"[,;]\s*", item.get("authorString", ""))
            if _clean_text(author)
        ]
        source_id = item.get("source")
        article_id = item.get("id")
        url = (
            f"https://europepmc.org/article/{source_id}/{article_id}"
            if source_id and article_id
            else f"https://europepmc.org/search?query={quote(query)}"
        )
        records.append(
            _record(
                "europepmc",
                item.get("title"),
                url,
                authors=authors,
                year=_year(item.get("pubYear")),
                venue=item.get("journalTitle"),
                doi=item.get("doi", ""),
                abstract=item.get("abstractText", ""),
                citations=item.get("citedByCount"),
            )
        )
    return [r for r in records if r]


def _fetch_arxiv(client, query, api_key=""):
    response = _get(
        client,
        "https://export.arxiv.org/api/query",
        params={
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": 15,
            "sortBy": "relevance",
        },
    )
    response.raise_for_status()
    root = ET.fromstring(response.text)
    records = []
    for entry in root.findall("a:entry", _ATOM):
        title = entry.findtext("a:title", default="", namespaces=_ATOM)
        authors = [
            author.findtext("a:name", default="", namespaces=_ATOM)
            for author in entry.findall("a:author", _ATOM)
        ]
        records.append(
            _record(
                "arxiv",
                title,
                entry.findtext("a:id", default="", namespaces=_ATOM),
                authors=authors,
                year=_year(entry.findtext("a:published", default="", namespaces=_ATOM)),
                venue="arXiv",
                doi=entry.findtext("x:doi", default="", namespaces=_ARXIV),
                abstract=entry.findtext("a:summary", default="", namespaces=_ATOM),
            )
        )
    return [r for r in records if r]


def _fetch_pubmed(client, query, api_key=""):
    search = _get(
        client,
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
        params={"db": "pubmed", "retmode": "json", "retmax": 15, "term": query},
    )
    search.raise_for_status()
    ids = search.json().get("esearchresult", {}).get("idlist", [])
    if not ids:
        return []
    summary = _get(
        client,
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
        params={"db": "pubmed", "retmode": "json", "id": ",".join(ids)},
    )
    summary.raise_for_status()
    result = summary.json().get("result", {})
    records = []
    for uid in ids:
        item = result.get(uid)
        if not isinstance(item, dict):
            continue
        doi = next(
            (
                article.get("value", "")
                for article in item.get("articleids", [])
                if article.get("idtype") == "doi"
            ),
            "",
        )
        records.append(
            _record(
                "pubmed",
                item.get("title"),
                f"https://pubmed.ncbi.nlm.nih.gov/{uid}/",
                authors=[
                    author.get("name", "")
                    for author in item.get("authors", [])
                    if isinstance(author, dict)
                ],
                year=_year(item.get("pubdate") or item.get("sortpubdate")),
                venue=item.get("fulljournalname") or item.get("source"),
                doi=doi,
            )
        )
    return [r for r in records if r]


def _fetch_semantic(client, query, api_key=""):
    fields = "title,abstract,authors,year,externalIds,url,citationCount,venue"
    response = _get(
        client,
        "https://api.semanticscholar.org/graph/v1/paper/search",
        params={"query": query, "limit": 15, "fields": fields},
        headers={"x-api-key": api_key} if api_key else None,
    )
    response.raise_for_status()
    items = response.json().get("data", [])
    records = []
    for item in items:
        external = item.get("externalIds") or {}
        records.append(
            _record(
                "semantic",
                item.get("title"),
                item.get("url", ""),
                authors=[author.get("name", "") for author in item.get("authors", [])],
                year=item.get("year"),
                venue=item.get("venue"),
                doi=external.get("DOI", ""),
                abstract=item.get("abstract", ""),
                citations=item.get("citationCount"),
            )
        )
    return [r for r in records if r]


_FETCHERS = {
    "crossref": _fetch_crossref,
    "openalex": _fetch_openalex,
    "europepmc": _fetch_europepmc,
    "arxiv": _fetch_arxiv,
    "pubmed": _fetch_pubmed,
    "semantic": _fetch_semantic,
}


# --- Ranking ----------------------------------------------------------------


def _dedupe(records):
    seen_doi, seen_title, unique = set(), set(), []
    for record in records:
        doi = record["doi"].lower()
        title = _title_key(record["title"])
        if (doi and doi in seen_doi) or (title and title in seen_title):
            continue
        if doi:
            seen_doi.add(doi)
        if title:
            seen_title.add(title)
        unique.append(record)
    return unique


_RANK_STOPWORDS = {
    "about",
    "and",
    "are",
    "between",
    "for",
    "from",
    "how",
    "into",
    "the",
    "that",
    "this",
    "using",
    "was",
    "were",
    "what",
    "when",
    "where",
    "which",
    "why",
    "with",
}


def _query_terms(query):
    """Keep meaningful words, plus short all-caps acronyms like IT or AI."""
    terms = []
    for token in re.findall(r"\w+", query):
        lower = token.lower()
        if lower in _RANK_STOPWORDS:
            continue
        if len(lower) >= 3 or token.isupper():
            terms.append(lower)
    return terms


def _rank(records, query, sort):
    terms = _query_terms(query)
    phrase = _clean_text(query).lower()

    def score(record):
        title = record["title"].lower()
        title_words = set(re.findall(r"\w+", title))
        body_words = set(
            re.findall(r"\w+", f"{title} {record['abstract'].lower()}")
        )
        value = 100 if phrase and phrase in title else 0
        value += 25 * sum(1 for term in terms if term in title_words)
        value += 4 * sum(1 for term in terms if term in body_words)
        value += min(record["citations"] or 0, 1000) ** 0.5
        return value

    def relevant(record):
        if not terms:
            return True
        body = f"{record['title']} {record['abstract']}".lower()
        if phrase and phrase in body:
            return True
        words = set(re.findall(r"\w+", body))
        needed = min(2, len(terms))
        return len({term for term in terms if term in words}) >= needed

    ranked = sorted(records, key=score, reverse=True)
    if sort == "newest":
        ranked = sorted(
            records, key=lambda r: (r["year"] or 0, score(r)), reverse=True
        )
    # Drop tangents such as "Fundamentals of Optics" for "IT fundamentals".
    return [record for record in ranked if relevant(record)]


def _scholar_url(title):
    return "https://scholar.google.com/scholar?q=" + quote(title)


class ScholarSearch:
    def __init__(self, api_key="", transport=None):
        self.api_key = api_key
        self._transport = transport

    @property
    def sources(self):
        return tuple(_PROVIDERS)

    @property
    def evidence_sources(self):
        return EVIDENCE_SOURCES

    def fetch(self, source, query):
        """Return (body, media_type) for one allow-listed scholarly source."""
        try:
            base, media_type = _PROVIDERS[source]
        except KeyError:
            raise ValueError("Unknown search source.") from None
        query = _clean_query(query)
        headers = {"User-Agent": USER_AGENT}
        if self.api_key:
            headers["x-api-key"] = self.api_key
        with httpx.Client(
            timeout=httpx.Timeout(30, connect=10),
            follow_redirects=True,
            headers=headers,
            transport=self._transport,
        ) as client:
            url = base + quote(query, safe="")
            # The public pools throttle bursts; short retries avoid most
            # transient 429/503 responses without a long user-visible wait.
            for attempt in range(ATTEMPTS):
                response = client.get(url)
                if response.status_code not in RETRIES or attempt == ATTEMPTS - 1:
                    response.raise_for_status()
                    return response.content, media_type
                time.sleep(2)

    def evidence(self, query, sources=None, sort="relevance"):
        """Retrieve, normalize, dedupe, and rank evidence from every source."""
        query = _clean_query(query)
        search_query = _expand_query(query)
        chosen = [
            source
            for source in (sources or DEFAULT_EVIDENCE_SOURCES)
            if source in EVIDENCE_SOURCES
        ]
        if not chosen:
            raise ValueError("Choose at least one search source.")
        records, failed = [], []
        with httpx.Client(
            timeout=httpx.Timeout(EVIDENCE_TIMEOUT, connect=5),
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
            transport=self._transport,
        ) as client:
            with ThreadPoolExecutor(max_workers=len(chosen)) as pool:
                futures = {
                    source: pool.submit(
                        _FETCHERS[source], client, search_query, self.api_key
                    )
                    for source in chosen
                }
                # Read results in requested source order so dedupe and ranking
                # stay deterministic regardless of which host answers first.
                for source in chosen:
                    try:
                        records.extend(futures[source].result())
                    except Exception:
                        failed.append(source)
        records = _rank(_dedupe(records), search_query, sort)[:MAX_EVIDENCE]
        for index, record in enumerate(records, 1):
            record["id"] = f"ev-{index}"
            record["scholar_url"] = _scholar_url(record["title"])
        return {
            "evidence": records,
            "coverage": {
                "ok": [source for source in chosen if source not in failed],
                "failed": failed,
            },
        }
