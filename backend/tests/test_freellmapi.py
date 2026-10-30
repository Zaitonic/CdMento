import json
import httpx
import pytest
from backend.config import Settings
from backend.repository import Repository
from backend.providers.gateway import Gateway, AIUnavailable
from backend.schemas import GroundedAnswer


def settings(tmp_path, **changes):
    return Settings(
        _env_file=None,
        data_dir=tmp_path,
        ai_enabled=True,
        ai_free_tier_confirmed=True,
        freellmapi_api_key="router-secret",
        freellmapi_free_tier_confirmed=True,
        **changes,
    )


@pytest.mark.parametrize(
    "field,value",
    [("freellmapi_model", "auto"), ("freellmapi_base_url", "https://example.com/v1")],
)
def test_router_rejects_unapproved_routes(tmp_path, field, value):
    cfg = settings(tmp_path)
    setattr(cfg, field, value)
    assert not Gateway(cfg, Repository(tmp_path)).configured


def test_router_requires_free_confirmation(tmp_path):
    cfg = settings(tmp_path)
    cfg.freellmapi_free_tier_confirmed = False
    assert not Gateway(cfg, Repository(tmp_path)).configured


def test_router_pins_model_and_honors_permission_and_retry(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        assert str(request.url) == "http://127.0.0.1:3001/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer router-secret"
        payload = json.loads(request.content)
        assert payload["model"] == "ministral-8b-latest"
        assert payload["response_format"]["type"] == "json_schema"
        assert payload["response_format"]["json_schema"]["strict"] is True
        return httpx.Response(429, headers={"retry-after": "120"})

    gateway = Gateway(
        settings(tmp_path),
        Repository(tmp_path),
        httpx.MockTransport(handler),
        clock=lambda: 1000,
    )
    gateway.permission_check = lambda provider: False
    with pytest.raises(ValueError, match="permission changed"):
        gateway.complete(GroundedAnswer, "system", "question")
    assert calls == []
    gateway.permission_check = lambda provider: provider == "mistral"
    with pytest.raises(AIUnavailable):
        gateway.complete(GroundedAnswer, "system", "question")
    assert len(calls) == 1
    assert gateway.status()["providers"][0]["retry_at"] == 1120
    assert "router-secret" not in json.dumps(gateway.status())


def test_mistral_is_automatic_through_api(tmp_path):
    from fastapi.testclient import TestClient
    from backend.ai import AIService
    from backend.main import create_app
    from backend.services import Services
    from backend.storage import FileStorage

    cfg = settings(tmp_path, worker_enabled=False)
    repo = Repository(tmp_path)
    service = Services(cfg, repo, FileStorage(tmp_path), AIService(cfg, repo))
    with TestClient(create_app(cfg, service)) as client:
        status = client.get("/api/v1/ai/status")
        assert status.status_code == 200
        assert status.json()["providers"][0]["name"] == "mistral"
        assert status.json()["approved_providers"] == ["mistral"]
        assert status.json()["automatic"] is True
        assert "router-secret" not in status.text


def test_unverified_mistral_reviewers_do_not_send_material(tmp_path):
    from backend.ai import AIService

    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(500)

    cfg = settings(tmp_path)
    ai = AIService(cfg, Repository(tmp_path), httpx.MockTransport(handler))
    with pytest.raises(ValueError, match="reviewer accuracy checks"):
        ai.generate(
            {"kind": "guide"},
            [{"id": "lesson", "name": "Lesson", "text": "A variable stores a value."}],
        )
    assert calls == []


def test_invalid_answers_are_not_reported_as_quota_exhaustion(tmp_path):
    def handler(request):
        return httpx.Response(
            200,
            json={"choices": [{"finish_reason": "stop", "message": {"content": "{}"}}]},
        )

    gateway = Gateway(
        settings(tmp_path),
        Repository(tmp_path),
        httpx.MockTransport(handler),
        clock=lambda: 1000,
    )
    for attempt in range(2):
        with pytest.raises(AIUnavailable, match="source or format checks"):
            gateway.complete(GroundedAnswer, "system", "question")
