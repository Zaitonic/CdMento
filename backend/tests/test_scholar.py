import httpx
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
