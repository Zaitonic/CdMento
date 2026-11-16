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
