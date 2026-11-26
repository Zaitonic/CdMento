import httpx
import pytest
from fastapi.testclient import TestClient
from backend.ai import AIService, brief_support, extractive_brief
from backend.config import Settings
from backend.main import create_app, user
from backend.repository import Repository
from backend.scholar import ScholarSearch
from backend.services import Services
from backend.storage import FileStorage


CROSSREF_PAYLOAD = {
    "message": {
        "items": [
            {
                "DOI": "10.1/it-basics",
                "title": ["Information technology fundamentals for beginners"],
                "author": [{"given": "Ada", "family": "Lovelace"}],
                "issued": {"date-parts": [[2023]]},
                "container-title": ["Journal of IT"],
                "abstract": (
                    "Information technology fundamentals cover hardware, software, "
                    "networks, data, and security."
                ),
                "URL": "https://doi.org/10.1/it-basics",
                "is-referenced-by-count": 12,
            },
            {
                "DOI": "10.1/it-basics",
                "title": ["Information technology fundamentals for beginners"],
                "author": [{"given": "Ada", "family": "Lovelace"}],
                "issued": {"date-parts": [[2023]]},
                "container-title": ["Journal of IT"],
                "abstract": "Duplicate record.",
                "URL": "https://doi.org/10.1/it-basics",
                "is-referenced-by-count": 12,
            },
        ]
    }
}


def evidence_transport(request):
    host = request.url.host
    if host == "api.crossref.org":
        return httpx.Response(200, json=CROSSREF_PAYLOAD)
    return httpx.Response(500)


class BriefAI:
    configured = True

    def __init__(self, fail=False):
        self.fail = fail
        self.calls = 0

    def topic_brief(self, query, evidence):
        self.calls += 1
        if self.fail:
            raise ValueError("AI is unavailable")
        first = evidence[0]["id"] if evidence else None
        return {
            "brief": {
                "title": query.title(),
                "overview": "Information technology is the use of computers and networks.",
                "overview_evidence_ids": [first] if first else [],
                "sections": [
                    {
                        "heading": "Core areas",
                        "points": [
                            {
                                "text": "Hardware, software, networks, and data are core areas.",
                                "evidence_ids": [first] if first else [],
                            },
                            {
                                "text": "Security protects systems and information.",
                                "evidence_ids": [],
                            },
                        ],
                    }
                ],
                "key_terms": ["hardware", "software", "networks"],
                "further_reading": [evidence[0]["title"]] if evidence else [],
            },
            "support": "partial",
            "_ai": {"provider": "test", "model": "test-model"},
        }


@pytest.fixture
def client(tmp_path):
    config = Settings(
        _env_file=None,
        data_dir=tmp_path,
        worker_enabled=False,
        auth_mode="local",
        data_backend="sqlite",
    )
    services = Services(
        config, Repository(tmp_path), FileStorage(tmp_path), BriefAI()
    )
    app = create_app(services=services)
    app.dependency_overrides[user] = lambda: "alice"
    app.state.scholar = ScholarSearch(transport=httpx.MockTransport(evidence_transport))
    with TestClient(app) as test_client:
        yield test_client, app, services


def brief_payload(**overrides):
    body = {
        "query": "IT fundamentals",
        "sources": ["crossref"],
        "sort": "relevance",
    }
    body.update(overrides)
    return body


def test_brief_returns_answer_evidence_and_support(client):
    test_client, _, services = client

    response = test_client.post("/api/v1/search/brief", json=brief_payload())

    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "IT fundamentals"
    assert data["brief"]["title"] == "It Fundamentals"
    assert data["support"] == "partial"
    assert data["cached"] is False
    assert data["coverage"] == {"ok": ["crossref"], "failed": []}
    assert len(data["evidence"]) == 1
    evidence = data["evidence"][0]
    assert evidence["id"] == "ev-1"
    assert evidence["doi"] == "10.1/it-basics"
    assert evidence["authors"] == ["Ada Lovelace"]
    assert evidence["scholar_url"].startswith("https://scholar.google.com/scholar?q=")
    assert data["ai"] == {"provider": "test", "model": "test-model"}
    assert services.ai.calls == 1


def test_brief_uses_the_fetched_papers_as_its_exact_evidence(client):
    test_client, app, _ = client
    app.state.scholar = ScholarSearch(transport=httpx.MockTransport(
        lambda request: pytest.fail("Client-fetched papers should prevent a second provider search")
    ))
    paper = {
        "id": "crossref-10.1/client",
        "source": "crossref",
        "title": "Information technology fundamentals",
        "url": "https://doi.org/10.1/client",
        "authors": ["Ada Lovelace"],
        "year": 2023,
        "venue": "Journal of IT",
        "doi": "10.1/client",
        "abstract": "A concise overview of information technology.",
        "citations": 7,
    }
    response = test_client.post(
        "/api/v1/search/brief",
        json=brief_payload(papers=[paper]),
    )

    assert response.status_code == 200
    assert response.json()["evidence"] == [{
        **paper,
        "scholar_url": "https://scholar.google.com/scholar?q=Information%20technology%20fundamentals",
    }]


def test_brief_is_cached_per_owner_and_query(client):
    test_client, _, services = client

    first = test_client.post("/api/v1/search/brief", json=brief_payload())
    second = test_client.post("/api/v1/search/brief", json=brief_payload())

    assert first.status_code == second.status_code == 200
    assert second.json()["cached"] is True
    assert services.ai.calls == 1


def test_brief_falls_back_to_an_extractive_digest(client):
    test_client, _, services = client
    services.ai = BriefAI(fail=True)

    response = test_client.post("/api/v1/search/brief", json=brief_payload())

    assert response.status_code == 200
    data = response.json()
    assert data["support"] == "evidence-only"
    assert "AI overview is unavailable" in data["brief"]["overview"]
    assert data["brief"]["sections"][0]["points"][0]["evidence_ids"] == ["ev-1"]


def test_brief_rejects_unknown_sources(client):
    test_client, _, _ = client

    response = test_client.post(
        "/api/v1/search/brief", json=brief_payload(sources=["bing"])
    )

    assert response.status_code == 400
    assert "search source" in response.json()["error"]


def test_brief_rate_limits_ten_per_hour(client):
    test_client, _, _ = client

    for index in range(10):
        response = test_client.post(
            "/api/v1/search/brief",
            json=brief_payload(query=f"topic {index}"),
        )
        assert response.status_code == 200
    limited = test_client.post(
        "/api/v1/search/brief", json=brief_payload(query="one more")
    )
    assert limited.status_code == 429
    assert limited.json()["kind"] == "rate_limit"


def test_brief_support_levels():
    base = {
        "overview": "Overview",
        "sections": [
            {
                "heading": "A",
                "points": [
                    {"text": "One", "evidence_ids": ["ev-1"]},
                    {"text": "Two", "evidence_ids": []},
                ],
            }
        ],
    }
    assert brief_support({**base, "overview_evidence_ids": []}) == "partial"
    assert brief_support(
        {
            **base,
            "overview_evidence_ids": [],
            "sections": [
                {
                    "heading": "A",
                    "points": [{"text": "One", "evidence_ids": []}],
                }
            ],
        }
    ) == "general"


def test_extractive_brief_is_fully_cited():
    evidence = [
        {
            "id": "ev-1",
            "title": "Information technology fundamentals",
            "abstract": "IT covers hardware and software. It also covers networks.",
            "year": 2023,
        },
        {
            "id": "ev-2",
            "title": "Network security basics",
            "abstract": "Security protects data.",
            "year": 2022,
        },
    ]

    result = extractive_brief("IT fundamentals", evidence)

    assert result["overview_evidence_ids"] == ["ev-1", "ev-2"]
    assert result["sections"][0]["points"][0]["evidence_ids"] == ["ev-1"]
    assert "AI overview is unavailable" in result["overview"]


def test_topic_brief_rejects_invented_evidence_ids():
    service = AIService(Settings(_env_file=None))
    payload = {
        "title": "IT fundamentals",
        "overview": "A general overview.",
        "overview_evidence_ids": ["ev-9"],
        "sections": [
            {
                "heading": "Basics",
                "points": [{"text": "A point.", "evidence_ids": ["ev-9"]}],
            }
        ],
        "key_terms": [],
        "further_reading": [],
    }

    class Gateway:
        def complete(self, schema, system, prompt, validate=None):
            result = schema.model_validate(payload).model_dump()
            if validate:
                validate(result)
            return result

    service.gateway = Gateway()

    with pytest.raises(ValueError):
        service.topic_brief(
            "IT fundamentals",
            [{"id": "ev-1", "title": "Paper", "abstract": "", "year": 2024}],
        )
