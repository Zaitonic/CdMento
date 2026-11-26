import httpx
import json
import pytest
from fastapi.testclient import TestClient
from backend.config import Settings
from backend.repository import Repository
from backend.scholar import ScholarSearch
from backend.services import Services
from backend.storage import FileStorage
from backend.main import create_app, user


class FakeAI:
    configured = False


@pytest.fixture
def client(tmp_path):
    config = Settings(
        _env_file=None,
        data_dir=tmp_path,
        worker_enabled=False,
        auth_mode="local",
        data_backend="sqlite",
    )
    services = Services(config, Repository(tmp_path), FileStorage(tmp_path), FakeAI())
    app = create_app(services=services)
    app.dependency_overrides[user] = lambda: "alice"
    with TestClient(app) as test_client:
        yield test_client, app


def test_semantic_proxy_returns_upstream_json(client):
    test_client, app = client
    seen = []

    def handler(request: httpx.Request):
        seen.append(str(request.url))
        return httpx.Response(200, json={"data": [{"paperId": "p1"}]})

    app.state.scholar = ScholarSearch(transport=httpx.MockTransport(handler))

    response = test_client.get(
        "/api/v1/search/semantic", params={"query": "spaced repetition"}
    )

    assert response.status_code == 200
    assert response.json() == {"data": [{"paperId": "p1"}]}
    assert seen == [
        "https://api.semanticscholar.org/graph/v1/paper/search"
        "?limit=15&fields=title,abstract,authors,year,externalIds,url,"
        "citationCount,venue&query=spaced%20repetition"
    ]


def test_arxiv_proxy_returns_atom_xml(client):
    test_client, app = client

    def handler(request: httpx.Request):
        assert request.url.path == "/api/query"
        return httpx.Response(200, text="<feed><entry /></feed>")

    app.state.scholar = ScholarSearch(transport=httpx.MockTransport(handler))

    response = test_client.get("/api/v1/search/arxiv", params={"query": "graph theory"})

    assert response.status_code == 200
    assert response.text == "<feed><entry /></feed>"
    assert response.headers["content-type"].startswith("application/xml")


def test_proxy_rejects_unknown_sources_and_empty_queries(client):
    test_client, _ = client

    assert test_client.get("/api/v1/search/bing?query=x").status_code == 404
    invalid = test_client.get("/api/v1/search/semantic?query=")
    assert invalid.status_code == 400
    assert invalid.json()["error"] == "Enter a topic to search."
    too_long = test_client.get(
        "/api/v1/search/arxiv", params={"query": "x" * 201}
    )
    assert too_long.status_code == 400


def test_semantic_proxy_passes_year_filter_and_removes_out_of_range_papers(client):
    test_client, app = client
    seen = []

    def handler(request: httpx.Request):
        seen.append(request.url.params.get("year"))
        return httpx.Response(200, json={"data": [
            {"paperId": "old", "year": 2018},
            {"paperId": "new", "year": 2022},
            {"paperId": "unknown", "year": None},
        ]})

    app.state.scholar = ScholarSearch(transport=httpx.MockTransport(handler))
    response = test_client.get("/api/v1/search/semantic", params={"query": "memory", "year_from": 2020, "year_to": 2023})
    assert response.status_code == 200
    assert seen == ["2020-2023"]
    assert [paper["paperId"] for paper in response.json()["data"]] == ["new"]
    assert test_client.get("/api/v1/search/arxiv", params={"query": "memory", "year_from": 2024, "year_to": 2020}).status_code == 422


def test_google_scholar_proxy_normalizes_serpapi_results_and_years(client):
    test_client, app = client
    seen = []

    def handler(request: httpx.Request):
        seen.append(dict(request.url.params))
        return httpx.Response(200, json={"organic_results": [{
            "title": "IT fundamentals",
            "link": "https://example.org/it",
            "publication_info": {
                "summary": "A Lovelace, Journal of IT, 2023",
                "authors": [{"name": "Ada Lovelace"}],
            },
            "snippet": "An introduction to information technology.",
            "inline_links": {"cited_by": {"total": 12}},
        }]})

    app.state.scholar = ScholarSearch(
        transport=httpx.MockTransport(handler), serpapi_api_key="server-secret"
    )
    response = test_client.get("/api/v1/search/google_scholar", params={
        "q": "IT fundamentals", "year_from": 2020, "year_to": 2024, "sort": "newest",
    })

    assert response.status_code == 200
    paper = response.json()["data"][0]
    assert paper == {
        "id": "", "source": "google_scholar", "title": "IT fundamentals",
        "authors": ["Ada Lovelace"], "year": 2023,
        "venue": "A Lovelace, Journal of IT, 2023", "doi": "",
        "url": "https://example.org/it",
        "abstract": "An introduction to information technology.", "citations": 12,
    }
    assert seen[0]["engine"] == "google_scholar"
    assert seen[0]["as_ylo"] == "2020" and seen[0]["as_yhi"] == "2024"
    assert seen[0]["scisbd"] == "1"
    assert "server-secret" not in response.text


def test_google_scholar_serper_parses_publication_info_and_sends_json(client):
    test_client, app = client
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200, json={"organic": [{
            "title": "IT fundamentals",
            "link": "https://example.org/it-fundamentals",
            "publicationInfo": "Ada Lovelace, Grace Hopper - Journal of IT, 2023",
            "snippet": "An introduction to information technology.",
            "citedBy": {"total": 18},
            "pdfUrl": "https://example.org/it-fundamentals.pdf",
        }]})

    app.state.scholar = ScholarSearch(
        transport=httpx.MockTransport(handler), serper_api_key="server-secret"
    )
    response = test_client.get("/api/v1/search/google_scholar", params={
        "q": "IT fundamentals", "year_from": 2023,
    })

    assert response.status_code == 200, response.text
    paper = response.json()["data"][0]
    assert paper["title"] == "IT fundamentals"
    assert paper["authors"] == ["Ada Lovelace", "Grace Hopper"]
    assert paper["year"] == 2023
    assert paper["venue"] == "Journal of IT"
    assert paper["citations"] == 18
    assert paper["abstract"] == "An introduction to information technology."
    assert paper["url"] == "https://example.org/it-fundamentals"
    assert seen[0].method == "POST"
    assert str(seen[0].url) == "https://google.serper.dev/scholar"
    assert seen[0].headers["x-api-key"] == "server-secret"
    assert seen[0].headers["content-type"] == "application/json"
    assert seen[0].read() == b'{"q":"IT fundamentals","as_ylo":2023}'
    assert "server-secret" not in response.text


def test_serper_retries_without_rejected_year_parameters_and_post_filters(client):
    test_client, app = client
    seen = []

    def handler(request: httpx.Request):
        body = json.loads(request.content)
        seen.append(body)
        if "as_ylo" in body:
            return httpx.Response(400, json={"message": "unsupported year filter"})
        return httpx.Response(200, json={"organic": [
            {"title": "Old IT study", "year": 2022, "link": "https://example.org/old"},
            {"title": "Current IT study", "year": 2023, "link": "https://example.org/current"},
        ]})

    app.state.scholar = ScholarSearch(
        transport=httpx.MockTransport(handler), serper_api_key="server-secret"
    )
    response = test_client.get("/api/v1/search/google_scholar", params={
        "q": "IT fundamentals", "year_from": 2023,
    })

    assert response.status_code == 200
    assert seen == [
        {"q": "IT fundamentals", "as_ylo": 2023},
        {"q": "IT fundamentals"},
    ]
    assert [paper["year"] for paper in response.json()["data"]] == [2023]


def test_papers_source_proxy_returns_the_same_normalized_record_shape(client):
    test_client, app = client

    def handler(request: httpx.Request):
        return httpx.Response(200, json={"message": {"items": [{
            "DOI": "10.1/it", "title": ["Information technology fundamentals"],
            "author": [{"given": "Ada", "family": "Lovelace"}],
            "issued": {"date-parts": [[2023]]}, "URL": "https://doi.org/10.1/it",
        }]}})

    app.state.scholar = ScholarSearch(transport=httpx.MockTransport(handler))
    response = test_client.get("/api/v1/search/crossref", params={"q": "it", "sort": "newest"})

    assert response.status_code == 200
    paper = response.json()["data"][0]
    assert paper["id"].startswith("crossref-ev-")
    assert paper["sourceId"] == "crossref" and paper["sourceName"] == "Crossref"
    assert paper["title"] == "Information technology fundamentals"
    assert paper["authors"] == ["Ada Lovelace"] and paper["year"] == 2023


def test_google_scholar_without_key_returns_clear_setup_message(client):
    test_client, _ = client
    response = test_client.get("/api/v1/search/google_scholar", params={"q": "it"})
    assert response.status_code == 503
    assert response.json()["error"] == "Google Scholar requires SERPAPI_API_KEY or SERPER_API_KEY"


def test_evidence_retries_without_rejected_year_filter_and_post_filters():
    seen = []

    def handler(request: httpx.Request):
        seen.append(dict(request.url.params))
        if request.url.params.get("filter"):
            return httpx.Response(400, json={"message": "unsupported date filter"})
        return httpx.Response(200, json={"message": {"items": [
            {"DOI": "10.1/old", "title": ["Old memory study"], "issued": {"date-parts": [[2018]]}},
            {"DOI": "10.1/in", "title": ["Memory study in range"], "issued": {"date-parts": [[2022]]}},
            {"DOI": "10.1/new", "title": ["New memory study"], "issued": {"date-parts": [[2025]]}},
        ]}})

    result = ScholarSearch(transport=httpx.MockTransport(handler)).evidence(
        "memory study", ["crossref"], year_from=2020, year_to=2023,
    )
    assert len(seen) == 2
    assert "filter" in seen[0] and "filter" not in seen[1]
    assert [item["year"] for item in result["evidence"]] == [2022]


def test_evidence_applies_provider_year_filters_and_post_filters():
    seen = []

    def handler(request: httpx.Request):
        seen.append(dict(request.url.params))
        return httpx.Response(200, json={"message": {"items": [
            {"DOI": "10.1/old", "title": ["Memory study old"], "issued": {"date-parts": [[2019]]}},
            {"DOI": "10.1/new", "title": ["Memory study new"], "issued": {"date-parts": [[2022]]}},
        ]}})

    result = ScholarSearch(transport=httpx.MockTransport(handler)).evidence(
        "memory study", ["crossref"], year_from=2020, year_to=2023,
    )
    assert seen[0]["filter"] == "from-pub-date:2020-01-01,until-pub-date:2023-12-31"
    assert [item["year"] for item in result["evidence"]] == [2022]


def test_proxy_reports_upstream_failures_without_leaking_details(client):
    test_client, app = client

    def handler(request: httpx.Request):
        return httpx.Response(503, text="upstream secret detail")

    app.state.scholar = ScholarSearch(transport=httpx.MockTransport(handler))

    response = test_client.get("/api/v1/search/semantic", params={"query": "ml"})

    assert response.status_code == 502
    assert response.json()["error"] == "This source is unavailable right now."
    assert "secret" not in response.text


def test_scholar_sends_api_key_when_configured():
    seen = {}

    def handler(request: httpx.Request):
        seen.update(request.headers)
        return httpx.Response(200, json={"data": []})

    ScholarSearch(
        api_key="secret-key", transport=httpx.MockTransport(handler)
    ).fetch("semantic", "ml")

    assert seen["x-api-key"] == "secret-key"
    assert seen["user-agent"].startswith("CdMento/")


def test_scholar_retries_transient_throttling(monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        calls.append(request.url)
        if len(calls) == 1:
            return httpx.Response(429)
        return httpx.Response(200, json={"data": []})

    monkeypatch.setattr("backend.scholar.time.sleep", lambda _: None)
    body, media_type = ScholarSearch(transport=httpx.MockTransport(handler)).fetch(
        "semantic", "ml"
    )

    assert len(calls) == 2
    assert media_type == "application/json"
    assert body == b'{"data":[]}'


def test_scholar_surfaces_persistent_throttling(monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        calls.append(request.url)
        return httpx.Response(429)

    monkeypatch.setattr("backend.scholar.time.sleep", lambda _: None)

    with pytest.raises(httpx.HTTPStatusError):
        ScholarSearch(transport=httpx.MockTransport(handler)).fetch("semantic", "ml")
    assert len(calls) == 3


def test_proxy_rate_limits_per_account(client):
    test_client, app = client

    def handler(request: httpx.Request):
        return httpx.Response(200, json={"data": []})

    app.state.scholar = ScholarSearch(transport=httpx.MockTransport(handler))

    for _ in range(30):
        assert (
            test_client.get("/api/v1/search/semantic", params={"query": "ml"}).status_code
            == 200
        )
    limited = test_client.get("/api/v1/search/semantic", params={"query": "ml"})
    assert limited.status_code == 429
    assert limited.json()["kind"] == "rate_limit"


def test_evidence_normalizes_dedupes_and_ranks_sources():
    def handler(request: httpx.Request):
        host = request.url.host
        if host == "api.crossref.org":
            return httpx.Response(
                200,
                json={
                    "message": {
                        "items": [
                            {
                                "DOI": "10.1/shared",
                                "title": ["Spaced repetition improves retention"],
                                "author": [{"given": "Ada", "family": "Lovelace"}],
                                "issued": {"date-parts": [[2021]]},
                                "container-title": ["Learning Journal"],
                                "abstract": "Spaced repetition helps long-term memory.",
                                "URL": "https://doi.org/10.1/shared",
                                "is-referenced-by-count": 15,
                            }
                        ]
                    }
                },
            )
        if host == "api.openalex.org":
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "display_name": "Spaced repetition improves retention",
                            "doi": "https://doi.org/10.1/shared",
                            "publication_year": 2021,
                            "cited_by_count": 15,
                            "authorships": [
                                {"author": {"display_name": "Ada Lovelace"}}
                            ],
                            "primary_location": {
                                "landing_page_url": "https://example.org/shared",
                                "source": {"display_name": "Learning Journal"},
                            },
                        },
                        {
                            "display_name": "Spaced repetition and working memory",
                            "doi": "https://doi.org/10.1/other",
                            "publication_year": 2019,
                            "cited_by_count": 3,
                            "authorships": [],
                            "primary_location": {
                                "landing_page_url": "https://example.org/other"
                            },
                            "abstract_inverted_index": {
                                "Memory": [0],
                                "improves": [1],
                            },
                        },
                    ]
                },
            )
        if host == "www.ebi.ac.uk":
            return httpx.Response(
                200,
                json={
                    "resultList": {
                        "result": [
                            {
                                "id": "MED-1",
                                "source": "MED",
                                "title": "Spaced repetition in the classroom",
                                "authorString": "Grace Hopper",
                                "pubYear": "2020",
                                "journalTitle": "Memory",
                                "abstractText": "A controlled study.",
                                "citedByCount": 4,
                                "doi": "10.1/third",
                            }
                        ]
                    }
                },
            )
        raise AssertionError(f"unexpected host {host}")

    result = ScholarSearch(transport=httpx.MockTransport(handler)).evidence(
        "spaced repetition", ["crossref", "openalex", "europepmc"]
    )

    evidence = result["evidence"]
    assert result["coverage"] == {
        "ok": ["crossref", "openalex", "europepmc"],
        "failed": [],
    }
    assert len(evidence) == 3
    assert [item["id"] for item in evidence] == ["ev-1", "ev-2", "ev-3"]
    assert evidence[0]["source"] == "crossref"
    assert evidence[0]["doi"] == "10.1/shared"
    assert not any(
        item["doi"] == "10.1/shared" for item in evidence[1:]
    )
    openalex = next(
        item
        for item in evidence
        if item["source"] == "openalex" and item["title"].startswith("Spaced repetition and working")
    )
    assert openalex["abstract"] == "Memory improves"
    assert all(
        item["scholar_url"].startswith("https://scholar.google.com/scholar?q=")
        for item in evidence
    )


def test_evidence_reports_failed_sources_without_dropping_others():
    def handler(request: httpx.Request):
        if request.url.host == "api.crossref.org":
            return httpx.Response(
                200,
                json={
                    "message": {
                        "items": [
                            {
                                "DOI": "10.1/ok",
                                "title": ["Memory and learning"],
                                "issued": {"date-parts": [[2022]]},
                                "URL": "https://doi.org/10.1/ok",
                            }
                        ]
                    }
                },
            )
        return httpx.Response(503)

    result = ScholarSearch(transport=httpx.MockTransport(handler)).evidence(
        "memory", ["crossref", "openalex"]
    )

    assert result["coverage"] == {"ok": ["crossref"], "failed": ["openalex"]}
    assert [item["source"] for item in result["evidence"]] == ["crossref"]


def test_evidence_parses_arxiv_atom():
    atom = """<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>http://arxiv.org/abs/2401.00001v1</id>
        <title>Spaced repetition and memory</title>
        <summary>A study of spaced repetition.</summary>
        <published>2024-01-02T00:00:00Z</published>
        <author><name>Ada Lovelace</name></author>
        <author><name>Grace Hopper</name></author>
      </entry>
    </feed>
    """

    def handler(request: httpx.Request):
        return httpx.Response(200, text=atom)

    result = ScholarSearch(transport=httpx.MockTransport(handler)).evidence(
        "spaced repetition", ["arxiv"]
    )

    record = result["evidence"][0]
    assert record["source"] == "arxiv"
    assert record["year"] == 2024
    assert record["authors"] == ["Ada Lovelace", "Grace Hopper"]
    assert record["abstract"] == "A study of spaced repetition."


def test_evidence_rejects_unknown_sources():
    with pytest.raises(ValueError, match="Choose at least one"):
        ScholarSearch().evidence("memory", ["bing"])


def test_evidence_respects_newest_sort():
    def handler(request: httpx.Request):
        return httpx.Response(
            200,
            json={
                "message": {
                    "items": [
                        {
                            "DOI": "10.1/old",
                            "title": ["Spaced repetition older paper"],
                            "issued": {"date-parts": [[2010]]},
                            "URL": "https://doi.org/10.1/old",
                        },
                        {
                            "DOI": "10.1/new",
                            "title": ["Spaced repetition newer paper"],
                            "issued": {"date-parts": [[2024]]},
                            "URL": "https://doi.org/10.1/new",
                        },
                    ]
                }
            },
        )

    result = ScholarSearch(transport=httpx.MockTransport(handler)).evidence(
        "spaced repetition", ["crossref"], sort="newest"
    )

    assert [item["year"] for item in result["evidence"]] == [2024, 2010]


def test_evidence_expands_acronyms_and_drops_tangents():
    seen = []

    def handler(request: httpx.Request):
        seen.append(dict(request.url.params))
        return httpx.Response(
            200,
            json={
                "message": {
                    "items": [
                        {
                            "DOI": "10.1/it",
                            "title": ["Fundamentals of Information Technology"],
                            "issued": {"date-parts": [[2020]]},
                            "URL": "https://doi.org/10.1/it",
                            "abstract": "Information technology basics for students.",
                        },
                        {
                            "DOI": "10.1/optics",
                            "title": ["Fundamentals of Optics"],
                            "issued": {"date-parts": [[2018]]},
                            "URL": "https://doi.org/10.1/optics",
                            "abstract": "Light and lenses.",
                        },
                    ]
                }
            },
        )

    result = ScholarSearch(transport=httpx.MockTransport(handler)).evidence(
        "IT fundamentals", ["crossref"]
    )

    assert seen[0]["query.bibliographic"] == "information technology fundamentals"
    titles = [item["title"] for item in result["evidence"]]
    assert "Fundamentals of Information Technology" in titles
    assert "Fundamentals of Optics" not in titles
