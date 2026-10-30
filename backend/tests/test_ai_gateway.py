import json
import httpx
import pytest
from fastapi.testclient import TestClient
from backend.config import Settings
from backend.repository import Repository
from backend.storage import FileStorage
from backend.services import Services
from backend.ai import AIService
from backend.schemas import GroundedAnswer
from backend.providers.gateway import Gateway, AIUnavailable, AIRefused
from backend.main import create_app


def config(tmp_path, **kwargs):
    values = {
        "_env_file": None,
        "data_dir": tmp_path,
        "worker_enabled": False,
        "ai_enabled": True,
        "ai_free_tier_confirmed": True,
        "groq_api_key": "groq-test-secret",
        "openrouter_api_key": "openrouter-test-secret",
        "openrouter_model": "example/model:free",
        **kwargs,
    }
    return Settings(**values)


def answer():
    return {
        "answer": "A variable stores a value.",
        "source_ids": ["source-1"],
        "citations": [
            {
                "source_id": "source-1",
                "page": 1,
                "section": None,
                "quote": "Variables store values.",
            }
        ],
    }


def result(request, value):
    return httpx.Response(
        200,
        json={
            "choices": [
                {"finish_reason": "stop", "message": {"content": json.dumps(value)}}
            ]
        },
    )


def test_quota_fallback_keeps_context_and_persists_cooldown(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        if request.url.host == "api.groq.com":
            return httpx.Response(
                429, headers={"Retry-After": "120"}, json={"error": "quota"}
            )
        return result(request, answer())

    settings = config(tmp_path)
    repo = Repository(tmp_path)
    gateway = Gateway(settings, repo, transport=httpx.MockTransport(handler))
    value = gateway.complete(
        GroundedAnswer,
        "Study JSON",
        "Previous conversation: variable x. QUESTION: explain x",
    )
    assert value["_ai"]["provider"] == "openrouter"
    assert len(calls) == 2
    assert all(b"Previous conversation: variable x" in r.content for r in calls)
    assert all(b"secret" not in r.url.query for r in calls)
    another = Gateway(
        settings, Repository(tmp_path), transport=httpx.MockTransport(handler)
    )
    another.complete(GroundedAnswer, "Study JSON", "Question")
    assert len(calls) == 3 and calls[-1].url.host == "openrouter.ai"
    assert "secret" not in json.dumps(gateway.status())


def test_invalid_citations_trigger_next_provider(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        data = answer()
        if len(calls) == 1:
            data["citations"][0]["quote"] = "Invented definition."
        return result(request, data)

    ai = AIService(config(tmp_path), Repository(tmp_path), httpx.MockTransport(handler))
    sources = [
        {
            "id": "source-1",
            "name": "lesson.pdf",
            "chunks": [{"page": 1, "text": "Variables store values."}],
        }
    ]
    value = ai.answer(
        {"conversation_summary": "Earlier we discussed x"},
        sources,
        "What does a variable do?",
        [{"role": "user", "text": "I am studying x"}],
    )
    assert value["_ai"]["provider"] == "openrouter"
    assert len(calls) == 2
    assert all(
        b"Earlier we discussed x" in r.content and b"I am studying x" in r.content
        for r in calls
    )


def test_provider_refusal_does_not_bypass_to_backup(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "content_filter",
                        "message": {"content": ""},
                    }
                ]
            },
        )

    gateway = Gateway(
        config(tmp_path), Repository(tmp_path), transport=httpx.MockTransport(handler)
    )
    with pytest.raises(AIRefused):
        gateway.complete(GroundedAnswer, "JSON", "question")
    assert len(calls) == 1


@pytest.mark.parametrize(
    "model", ["openai/gpt-4.1", "openrouter/auto", "model:free:online"]
)
def test_paid_openrouter_model_rejected(tmp_path, model):
    gateway = Gateway(
        config(tmp_path, openrouter_api_key="router-secret", openrouter_model=model),
        Repository(tmp_path),
    )
    with pytest.raises(ValueError, match=":free"):
        gateway.require()


def test_openrouter_price_ceiling_and_no_paid_fallback(tmp_path):
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return result(request, answer())

    settings = Settings(
        _env_file=None,
        ai_free_tier_confirmed=True,
        openrouter_api_key="router-secret",
        openrouter_model="example/model:free",
    )
    gateway = Gateway(
        settings, Repository(tmp_path), transport=httpx.MockTransport(handler)
    )
    gateway.complete(GroundedAnswer, "JSON", "question")
    payload = seen[0]
    assert payload["provider"]["max_price"] == {
        "prompt": 0,
        "completion": 0,
        "request": 0,
    }
    assert payload["provider"]["allow_fallbacks"] is False
    assert payload["model"].endswith(":free") and "models" not in payload


def test_daily_budget_is_shared_between_instances(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        return result(request, answer())

    settings = config(tmp_path, ai_daily_requests=1)
    first = Gateway(
        settings, Repository(tmp_path), transport=httpx.MockTransport(handler)
    )
    first.complete(GroundedAnswer, "JSON", "one")
    first.complete(GroundedAnswer, "JSON", "two")
    other = Gateway(
        settings, Repository(tmp_path), transport=httpx.MockTransport(handler)
    )
    with pytest.raises(AIUnavailable):
        other.complete(GroundedAnswer, "JSON", "three")
    assert len(calls) == 2


def test_configuration_does_not_activate_legacy_paid_key(tmp_path):
    settings = Settings(_env_file=None, openai_api_key="legacy-paid-key")
    ai = AIService(settings, Repository(tmp_path))
    assert not ai.configured and ai.client is None
    with pytest.raises(ValueError, match="key"):
        ai.require()


def test_free_tier_confirmation_required(tmp_path):
    settings = Settings(_env_file=None, groq_api_key="test-key")
    gateway = Gateway(settings, Repository(tmp_path))
    with pytest.raises(ValueError, match="unbilled"):
        gateway.require()


def test_all_exhausted_providers_return_retry_without_secrets(tmp_path):
    def handler(request):
        return httpx.Response(
            429,
            headers={"Retry-After": "90"},
            json={"error": "groq-test-secret user-private-material"},
        )

    gateway = Gateway(
        config(tmp_path), Repository(tmp_path), transport=httpx.MockTransport(handler)
    )
    with pytest.raises(AIUnavailable) as caught:
        gateway.complete(GroundedAnswer, "JSON", "material")
    assert caught.value.retry_after == 90
    assert "secret" not in str(caught.value) and "private" not in str(caught.value)


def test_reviewer_processes_last_section_and_checks_quotes(tmp_path):
    seen = []

    def handler(request):
        payload = json.loads(request.content)
        prompt = (
            payload["contents"][0]["parts"][0]["text"]
            if "contents" in payload
            else payload["messages"][1]["content"]
        )
        seen.append(prompt)
        page = 2 if '"page": 2' in prompt else 1
        quote = "End of the chapter." if page == 2 else "Variables store values."
        review = {
            "title": "Programming reviewer",
            "overview": "Overview",
            "sections": [
                {
                    "heading": "Concept",
                    "content": "Explanation grounded in source.",
                    "citations": [
                        {
                            "source_id": "s",
                            "page": page,
                            "section": None,
                            "quote": quote,
                        }
                    ],
                }
            ],
            "practice_questions": [],
            "warnings": [],
        }
        return result(request, review)

    ai = AIService(config(tmp_path), Repository(tmp_path), httpx.MockTransport(handler))
    sources = [
        {
            "id": "s",
            "name": "lesson.pdf",
            "chunks": [
                {"page": 1, "text": "Variables store values. " + "x" * 6100},
                {"page": 2, "text": "End of the chapter."},
                {"page": 3, "text": "", "unreadable": True},
            ],
        }
    ]
    review = ai.reviewer({"style": "detailed", "pages": None}, sources)
    assert any("End of the chapter." in p for p in seen)
    assert review["coverage"]["parts"] == 2
    assert any("pages 3" in w for w in review["warnings"])
    assert len(review["sections"]) == 2


def api_environment(tmp_path, handler):
    settings = config(tmp_path)
    repo = Repository(tmp_path)
    ai = AIService(settings, repo, httpx.MockTransport(handler))
    service = Services(settings, repo, FileStorage(tmp_path), ai)
    return TestClient(create_app(services=service)), service


def add_source(client, service):
    book = client.post("/api/v1/notebooks", json={"name": "Programming"}).json()
    uploaded = client.post(
        f"/api/v1/notebooks/{book['id']}/sources",
        files={"file": ("lesson.txt", b"Variables store values.", "text/plain")},
    ).json()
    service.run_job("local-workspace", uploaded["job_id"])
    return book, uploaded["source"]["id"]


def test_upload_stays_local_and_generation_runs_automatically(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        return result(request, answer())

    client, service = api_environment(tmp_path, handler)
    with client:
        book, sid = add_source(client, service)
        assert calls == []
        path = f"/api/v1/notebooks/{book['id']}/generations"
        generated = client.post(path, json={"kind": "guide"})
        assert generated.status_code == 202
        assert generated.json()["job_id"]
        service.run_job("local-workspace", generated.json()["job_id"])
        assert calls and calls[0].url.host == "api.groq.com"


def test_configured_provider_is_used_without_manual_approval(tmp_path):
    sid = ""

    def handler(request):
        value = answer()
        value["source_ids"] = [sid]
        value["citations"][0].update(source_id=sid, page=None, section=1)
        return result(request, value)

    client, service = api_environment(tmp_path, handler)
    with client:
        book, sid = add_source(client, service)
        service.repo.put(
            "local-workspace",
            "preferences",
            {"id": "ai", "providers": ["gemini"]},
        )
        status = client.get("/api/v1/ai/status").json()
        assert status["automatic"] is True
        assert status["approved_providers"] == ["groq", "openrouter"]
        response = client.post(
            f"/api/v1/notebooks/{book['id']}/messages",
            json={"question": "What is a variable?"},
        )
        assert response.status_code == 200
        assert response.json()["ai"]["provider"] == "groq"


def test_generation_waits_durably_and_checkpoint_not_public(tmp_path):
    def handler(request):
        return httpx.Response(429, headers={"Retry-After": "120"})

    client, service = api_environment(tmp_path, handler)
    with client:
        book, sid = add_source(client, service)
        generated = client.post(
            f"/api/v1/notebooks/{book['id']}/generations", json={"kind": "guide"}
        ).json()
        service.run_job("local-workspace", generated["job_id"])
        job = client.get(f"/api/v1/jobs/{generated['job_id']}").json()
        assert job["status"] == "waiting" and job["retry_at"] > 0
        assert job["error_kind"] == "quota"
        assert "checkpoint" not in job
        duplicate = client.post(
            f"/api/v1/notebooks/{book['id']}/generations", json={"kind": "guide"}
        ).json()
        assert duplicate["job_id"] == generated["job_id"]


def reviewer_value(source_id, quote="Variables store values."):
    return {
        "title": "Programming reviewer",
        "overview": "A source-grounded overview.",
        "sections": [
            {
                "heading": "Variables",
                "content": "Variables store values.",
                "citations": [
                    {"source_id": source_id, "page": None, "section": 1, "quote": quote}
                ],
            }
        ],
        "practice_questions": [
            {
                "question": "What is a variable?",
                "answer": "A place to store a value.",
                "citations": [
                    {"source_id": source_id, "page": None, "section": 1, "quote": quote}
                ],
            }
        ],
        "warnings": [],
    }


def test_reviewer_saves_validated_material_to_note_once(tmp_path):
    sid = ""

    def handler(request):
        return result(request, reviewer_value(sid))

    client, service = api_environment(tmp_path, handler)
    with client:
        book, sid = add_source(client, service)
        generated = client.post(
            f"/api/v1/notebooks/{book['id']}/generations", json={"kind": "guide"}
        ).json()
        service.run_job("local-workspace", generated["job_id"])
        job = client.get(f"/api/v1/jobs/{generated['job_id']}").json()
        assert job["status"] == "completed"
        reviewer = client.get(f"/api/v1/artifacts/{generated['artifact_id']}").json()
        assert (
            reviewer["sections"][0]["citations"][0]["quote"]
            == "Variables store values."
        )
        first = client.post(f"/api/v1/artifacts/{reviewer['id']}/save-note")
        second = client.post(f"/api/v1/artifacts/{reviewer['id']}/save-note")
        assert first.status_code == 201 and second.json()["id"] == first.json()["id"]
        assert "Variables store values." in json.dumps(first.json()["document"])
        assert "sk-" not in json.dumps(reviewer)


def test_checkpoint_resumes_only_unfinished_reviewer_parts(tmp_path):
    recover = False
    calls = []
    sid = ""

    def handler(request):
        calls.append(request)
        if len(calls) > 1 and not recover:
            return httpx.Response(429, headers={"Retry-After": "120"})
        return result(request, reviewer_value(sid, "xxxxxxxx"))

    client, service = api_environment(tmp_path, handler)
    with client:
        book = client.post("/api/v1/notebooks", json={"name": "Long source"}).json()
        upload = client.post(
            f"/api/v1/notebooks/{book['id']}/sources",
            files={"file": ("chapter.txt", b"x" * 8000, "text/plain")},
        ).json()
        sid = upload["source"]["id"]
        service.run_job("local-workspace", upload["job_id"])
        generated = client.post(
            f"/api/v1/notebooks/{book['id']}/generations", json={"kind": "guide"}
        ).json()
        service.run_job("local-workspace", generated["job_id"])
        job = service.repo.get("local-workspace", "jobs", generated["job_id"])
        assert job["status"] == "waiting" and len(job["checkpoint"]) == 1
        recover = True
        for p in service.ai.gateway.providers:
            state = service.ai.gateway.state(p)
            service.repo.put(
                service.ai.gateway.OWNER, "providers", {**state, "retry_at": 0}
            )
        service.repo.put("local-workspace", "jobs", {**job, "retry_at": 0})
        service.run_job("local-workspace", job["id"])
        finished = client.get(f"/api/v1/jobs/{job['id']}").json()
        assert finished["status"] == "completed"
        assert len(calls) == 4
        assert "checkpoint" not in finished


def test_chat_queued_on_quota_then_continues_after_recovery(tmp_path):
    recover = False
    sid = ""

    def handler(request):
        if not recover:
            return httpx.Response(429, headers={"Retry-After": "30"})
        data = answer()
        data["source_ids"] = [sid]
        data["citations"][0].update(source_id=sid, page=None, section=1)
        return result(request, data)

    client, service = api_environment(tmp_path, handler)
    with client:
        book, sid = add_source(client, service)
        path = f"/api/v1/notebooks/{book['id']}/messages"
        queued = client.post(path, json={"question": "What is a variable?"})
        assert queued.status_code == 202
        jid = queued.json()["job_id"]
        assert (
            client.post(path, json={"question": "What is a variable?"}).json()["job_id"]
            == jid
        )
        assert (
            client.post(path, json={"question": "Another question"}).status_code == 409
        )
        recover = True
        for p in service.ai.gateway.providers:
            state = service.ai.gateway.state(p)
            service.repo.put(
                service.ai.gateway.OWNER, "providers", {**state, "retry_at": 0}
            )
        job = service.repo.get("local-workspace", "jobs", jid)
        service.repo.put("local-workspace", "jobs", {**job, "retry_at": 0})
        service.run_job("local-workspace", jid)
        history = client.get(f"/api/v1/notebooks/{book['id']}/conversation").json()
        assert len(history["messages"]) == 2
        assert (
            history["messages"][-1]["citations"][0]["quote"]
            == "Variables store values."
        )
        # Restarting a completed job must not duplicate the exchange.
        service.run_job("local-workspace", jid)
        assert (
            len(
                client.get(f"/api/v1/notebooks/{book['id']}/conversation").json()[
                    "messages"
                ]
            )
            == 2
        )


def test_reviewer_rejects_oversized_coverage_before_transmission(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        return result(request, answer())

    client, service = api_environment(tmp_path, handler)
    with client:
        book = client.post("/api/v1/notebooks", json={"name": "Long source"}).json()
        upload = client.post(
            f"/api/v1/notebooks/{book['id']}/sources",
            files={"file": ("long.txt", b"x" * 65000, "text/plain")},
        ).json()
        service.run_job("local-workspace", upload["job_id"])
        response = client.post(
            f"/api/v1/notebooks/{book['id']}/generations", json={"kind": "guide"}
        )
        assert response.status_code == 400
        assert calls == []


def cloudflare_config(**kwargs):
    return Settings(
        _env_file=None,
        ai_free_tier_confirmed=True,
        cloudflare_api_token="cf-test-secret",
        cloudflare_account_id="a" * 32,
        **kwargs,
    )


def test_cloudflare_fallback_preserves_context_and_validated_json(tmp_path):
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.host != "api.cloudflare.com":
            return httpx.Response(429, headers={"Retry-After": "90"})
        return result(request, answer())

    settings = cloudflare_config(
        groq_api_key="groq-secret", cloudflare_free_tier_confirmed=True
    )
    gateway = Gateway(
        settings, Repository(tmp_path), transport=httpx.MockTransport(handler)
    )
    value = gateway.complete(
        GroundedAnswer,
        "Check source quotes",
        "Previous conversation and source evidence",
    )
    assert value["_ai"]["provider"] == "cloudflare"
    request = seen[-1]
    assert (
        str(request.url)
        == "https://api.cloudflare.com/client/v4/accounts/"
        + "a" * 32
        + "/ai/v1/chat/completions"
    )
    payload = json.loads(request.content)
    assert payload["model"] == settings.cloudflare_model
    assert payload["response_format"] == {"type": "json_object"}
    assert (
        payload["messages"][1]["content"] == "Previous conversation and source evidence"
    )
    assert "provider" not in payload and "tools" not in payload
    assert request.headers["Authorization"] == "Bearer cf-test-secret"
    assert "cf-test-secret" not in json.dumps(gateway.status())


def test_cloudflare_requires_workers_free_confirmation(tmp_path):
    gateway = Gateway(cloudflare_config(), Repository(tmp_path))
    with pytest.raises(ValueError, match="Workers Free"):
        gateway.require()


@pytest.mark.parametrize(
    "changes, expected",
    [
        ({"cloudflare_account_id": "../foreign"}, "account ID"),
        ({"cloudflare_model": "@cf/moonshotai/kimi-k2.6"}, "allowlist"),
    ],
)
def test_cloudflare_rejects_invalid_account_and_paid_models(
    tmp_path, changes, expected
):
    settings = cloudflare_config(cloudflare_free_tier_confirmed=True)
    for key, value in changes.items():
        setattr(settings, key, value)
    with pytest.raises(ValueError, match=expected):
        Gateway(settings, Repository(tmp_path)).require()


def test_cloudflare_is_not_used_without_owner_permission(tmp_path):
    seen = []

    def handler(request):
        seen.append(request.url.host)
        return httpx.Response(429)

    gateway = Gateway(
        cloudflare_config(
            groq_api_key="groq-secret", cloudflare_free_tier_confirmed=True
        ),
        Repository(tmp_path),
        transport=httpx.MockTransport(handler),
    )
    gateway.permission_check = lambda name: name == "groq"
    with pytest.raises(AIUnavailable):
        gateway.complete(GroundedAnswer, "JSON", "private material")
    assert seen == ["api.groq.com"]


def test_unconfirmed_cloudflare_does_not_disable_existing_groq(tmp_path):
    gateway = Gateway(
        cloudflare_config(groq_api_key="groq-secret"), Repository(tmp_path)
    )
    assert gateway.configured
    assert [p.name for p in gateway.providers] == ["groq"]


def test_cloudflare_consent_and_chat_work_through_api(tmp_path):
    sid = ""
    calls = []

    def handler(request):
        calls.append(request)
        value = answer()
        value["source_ids"] = [sid]
        value["citations"][0].update(source_id=sid, page=None, section=1)
        return result(request, value)

    settings = cloudflare_config(
        data_dir=tmp_path, worker_enabled=False, cloudflare_free_tier_confirmed=True
    )
    repo = Repository(tmp_path)
    service = Services(
        settings,
        repo,
        FileStorage(tmp_path),
        AIService(settings, repo, httpx.MockTransport(handler)),
    )
    with TestClient(create_app(services=service)) as client:
        book, sid = add_source(client, service)
        path = f"/api/v1/notebooks/{book['id']}/messages"
        status = client.get("/api/v1/ai/status").json()
        assert status["automatic"] is True
        assert status["approved_providers"] == ["cloudflare"]
        reply = client.post(
            path, json={"question": "What is a variable?", "source_ids": [sid]}
        )
        assert reply.status_code == 200
        assert reply.json()["citations"][0]["source_id"] == sid
        assert len(calls) == 1 and calls[0].url.host == "api.cloudflare.com"
