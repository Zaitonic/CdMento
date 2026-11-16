"""Server-side fetch for scholarly APIs that block browser CORS requests.

Semantic Scholar and arXiv do not send Access-Control-Allow-Origin headers, so
they cannot be called directly from the browser. These helpers fetch on behalf
of the app; the upstream hosts are fixed and never taken from the request.
"""

import time
from urllib.parse import quote

import httpx

MAX_QUERY_LENGTH = 200
RETRIES = (429, 503)
ATTEMPTS = 3
USER_AGENT = "CdMento/1.0 (study workspace; scholarly search)"

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


class ScholarSearch:
    def __init__(self, api_key="", transport=None):
        self.api_key = api_key
        self._transport = transport

    @property
    def sources(self):
        return tuple(_PROVIDERS)

    def fetch(self, source, query):
        """Return (body, media_type) for one allow-listed scholarly source."""
        try:
            base, media_type = _PROVIDERS[source]
        except KeyError:
            raise ValueError("Unknown search source.") from None
        query = (query or "").strip()
        if not query:
            raise ValueError("Enter a topic to search.")
        if len(query) > MAX_QUERY_LENGTH:
            raise ValueError("Keep the search topic under 200 characters.")
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
