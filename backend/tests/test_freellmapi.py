import json
import httpx
import pytest
from backend.config import Settings
from backend.repository import Repository
from backend.providers.gateway import Gateway, AIUnavailable, OpenAICompatibleClient, Provider
from backend.schemas import GroundedAnswer


def settings(tmp_path, **changes):
    values = {
        "_env_file": None,
        "data_dir": tmp_path,
        "ai_enabled": True,
        "ai_free_tier_confirmed": True,
        "freellmapi_enabled": True,
        "freellmapi_api_key": "router-secret",
        "freellmapi_free_tier_confirmed": True,
    }
    values.update(changes)
    return Settings(**values)


@pytest.mark.parametrize(
    "field,value",
    [("freellmapi_model", ""), ("freellmapi_base_url", "not-a-url")],
)
def test_router_rejects_unapproved_routes(tmp_path, field, value):
    cfg = settings(tmp_path)
    setattr(cfg, field, value)
    assert not Gateway(cfg, Repository(tmp_path)).configured


def test_router_requires_free_confirmation(tmp_path):
    cfg = settings(tmp_path)
    cfg.freellmapi_free_tier_confirmed = False
    assert not Gateway(cfg, Repository(tmp_path)).configured


def test_router_requires_enabled_switch_and_key(tmp_path):
    cfg = settings(tmp_path, freellmapi_enabled=False)
    assert not Gateway(cfg, Repository(tmp_path)).configured


def test_localhost_router_works_with_google_auth_in_sqlite_development(tmp_path, monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    cfg = settings(tmp_path, auth_mode="google", google_client_id="local-client")
    assert Gateway(cfg, Repository(tmp_path)).configured


def test_localhost_router_is_rejected_in_vercel(tmp_path, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    cfg = settings(tmp_path)
    assert not Gateway(cfg, Repository(tmp_path)).configured
    cfg.freellmapi_enabled = True
    cfg.freellmapi_api_key = ""
    assert not Gateway(cfg, Repository(tmp_path)).configured


def test_streamed_openai_response_is_assembled(tmp_path):
    provider = Provider("freellmapi", "ministral-8b-latest", "router-secret", 10, "http://127.0.0.1:3001/v1")

    def handler(request):
        assert json.loads(request.content)["stream"] is True
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=(
                'data: {"choices":[{"delta":{"content":"{\\"answer\\":"}}]}\n\n'
                'data: {"choices":[{"delta":{"content":"\\"ok\\"}"},"finish_reason":"stop"}]}\n\n'
                "data: [DONE]\n\n"
            ),
        )

    response = OpenAICompatibleClient(provider, httpx.MockTransport(handler)).complete(
        [{"role": "user", "content": "question"}], stream=True
    )
    assert response.json()["choices"][0]["message"]["content"] == '{"answer":"ok"}'


def test_invalid_freellmapi_key_cools_down_without_leaking_secret(tmp_path):
    def handler(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(404)
        return httpx.Response(401, json={"error": "router-secret rejected"})

    gateway = Gateway(
        settings(tmp_path),
        Repository(tmp_path),
        httpx.MockTransport(handler),
        clock=lambda: 1000,
    )
    with pytest.raises(AIUnavailable):
        gateway.complete(GroundedAnswer, "system", "question")
    status = gateway.status()
    assert status["providers"][0]["health"] == "unavailable"
    assert status["providers"][0]["retry_at"] == 1300
    assert "router-secret" not in json.dumps(status)


def test_expired_provider_disable_recovers_automatically(tmp_path):
    cfg = settings(tmp_path)
    repo = Repository(tmp_path)
    gateway = Gateway(cfg, repo, clock=lambda: 2000)
    provider = gateway.providers[0]
    repo.put(
        gateway.OWNER,
        "providers",
        {
            "id": provider.name,
            "fingerprint": gateway.fingerprint(provider),
            "disabled": True,
            "retry_at": 1900,
            "used": 0,
            "day": "1970-01-01",
        },
        expected=0,
    )
    assert gateway.reserve(provider)
    assert not gateway.state(provider).get("disabled")


def test_router_pins_model_and_honors_permission_and_retry(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "ministral-8b-latest"}]})
        assert str(request.url) == "http://127.0.0.1:3001/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer router-secret"
        payload = json.loads(request.content)
        assert payload["model"] == "ministral-8b-latest"
        assert payload["response_format"]["type"] == "json_schema"
        assert payload["response_format"]["json_schema"]["strict"] is True
        assert payload["stream"] is True
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
    gateway.permission_check = lambda provider: provider == "freellmapi"
    with pytest.raises(AIUnavailable):
        gateway.complete(GroundedAnswer, "system", "question")
    assert len(calls) == 2
    assert gateway.status()["providers"][0]["retry_at"] == 1120
    assert "router-secret" not in json.dumps(gateway.status())


def test_freellmapi_is_automatic_through_api(tmp_path):
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
        assert status.json()["providers"][0]["name"] == "freellmapi"
        assert status.json()["approved_providers"] == ["freellmapi"]
        assert status.json()["automatic"] is True
        assert "router-secret" not in status.text


def test_freellmapi_reviewer_uses_configured_provider(tmp_path):
    from backend.ai import AIService

    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(404)
        return httpx.Response(500)

    cfg = settings(tmp_path)
    ai = AIService(cfg, Repository(tmp_path), httpx.MockTransport(handler))
    with pytest.raises(AIUnavailable):
        ai.generate(
            {"kind": "guide"},
            [{"id": "lesson", "name": "Lesson", "text": "A variable stores a value."}],
        )
    assert calls


def test_router_falls_back_after_unsupported_freellmapi_model(tmp_path):
    cfg = settings(
        tmp_path,
        groq_api_key="groq-secret",
        ai_provider_order="freellmapi,groq",
    )
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "different-model"}]})
        assert request.url.host == "api.groq.com"
        return httpx.Response(
            200,
            json={"choices": [{"finish_reason": "stop", "message": {"content": '{"answer":"ok","citations":[],"source_ids":[]}'}}]},
        )

    gateway = Gateway(
        cfg,
        Repository(tmp_path),
        httpx.MockTransport(handler),
        clock=lambda: 1000,
    )
    gateway.complete(GroundedAnswer, "system", "question")
    assert [request.url.host for request in calls] == [
        "127.0.0.1",
        "api.groq.com",
    ]
    assert gateway.status()["providers"][0]["health"] == "unavailable"


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
