import json

import httpx
import pytest

from backend.config import Settings
from backend.providers.gateway import Gateway, parse_extra_providers
from backend.repository import Repository
from backend.schemas import GroundedAnswer


def answer():
    return {
        "answer": "A variable stores a value.",
        "source_ids": ["source-1"],
        "citations": [{"source_id": "source-1", "page": 1, "section": None, "quote": "Variables store values."}],
    }


def result(value):
    return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(value)}}]})


def settings(tmp_path, **kwargs):
    return Settings(_env_file=None, data_dir=tmp_path, ai_free_tier_confirmed=True, **kwargs)


def test_extra_provider_validation_and_local_ssrf_rule():
    raw = json.dumps([
        {"name": "remote", "base_url": "http://169.254.169.254/v1", "api_key": "secret", "model": "x"},
        {"name": "valid", "base_url": "https://example.test/v1", "api_key": "secret", "model": "x"},
        {"name": "bad", "base_url": "https://example.test/v1", "api_key": "secret", "model": "x", "unknown": 1},
    ])
    providers = parse_extra_providers(raw)
    assert [p.name for p in providers] == ["valid"]
    local = parse_extra_providers(
        json.dumps([{ "name": "local", "base_url": "http://127.0.0.1:3001/v1", "api_key": "secret", "model": "x" }]),
        local_mode=True,
    )
    assert local[0].base_url.startswith("http://127.0.0.1")


def test_provider_order_and_secret_free_status(tmp_path):
    cfg = settings(
        tmp_path,
        groq_api_key="groq-secret",
        extra_ai_providers_json=json.dumps([
            {"name": "backup", "base_url": "https://backup.test/v1", "api_key": "extra-secret", "model": "x"}
        ]),
        ai_provider_order="backup,groq",
    )
    gateway = Gateway(cfg, Repository(tmp_path))
    assert [p.name for p in gateway.providers] == ["backup", "groq"]
    assert "secret" not in json.dumps(gateway.status())


def test_dynamic_provider_failover_cools_down_429_and_skips_it(tmp_path):
    calls = []

    def handler(request):
        calls.append(request.url.host)
        if request.url.host == "first.test":
            return httpx.Response(429, headers={"Retry-After": "60"})
        return result(answer())

    cfg = settings(
        tmp_path,
        extra_ai_providers_json=json.dumps([
            {"name": "first", "base_url": "https://first.test/v1", "api_key": "first-secret", "model": "x"},
            {"name": "second", "base_url": "https://second.test/v1", "api_key": "second-secret", "model": "x"},
        ]),
    )
    gateway = Gateway(cfg, Repository(tmp_path), transport=httpx.MockTransport(handler))
    assert gateway.complete(GroundedAnswer, "JSON", "question")["_ai"]["provider"] == "second"
    assert gateway.complete(GroundedAnswer, "JSON", "question")["_ai"]["provider"] == "second"
    assert calls == ["first.test", "second.test", "second.test"]


def test_invalid_json_response_fails_over(tmp_path):
    calls = []

    def handler(request):
        calls.append(request.url.host)
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": "not-json"}}]}) if len(calls) == 1 else result(answer())

    cfg = settings(
        tmp_path,
        extra_ai_providers_json=json.dumps([
            {"name": "bad-output", "base_url": "https://bad.test/v1", "api_key": "secret-a", "model": "x"},
            {"name": "good-output", "base_url": "https://good.test/v1", "api_key": "secret-b", "model": "x"},
        ]),
    )
    gateway = Gateway(cfg, Repository(tmp_path), transport=httpx.MockTransport(handler))
    assert gateway.complete(GroundedAnswer, "JSON", "question")["_ai"]["provider"] == "good-output"
    assert "secret" not in json.dumps(gateway.status())
