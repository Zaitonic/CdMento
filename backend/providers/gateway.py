"""Free-tier provider routing. Secrets and original files never enter public responses."""

import hashlib
import json
import logging
import os
import re
import ssl
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

log = logging.getLogger(__name__)


class ExtraProviderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=64)
    base_url: str
    api_key: str = Field(min_length=1)
    model: str = Field(min_length=1, max_length=200)
    enabled: bool = True
    timeout_seconds: int = Field(default=30, ge=5, le=60)
    extra_headers: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value):
            raise ValueError("name must contain only letters, numbers, '.', '_' or '-'")
        return value

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        normalized = value.rstrip("/")
        parsed = urlsplit(normalized)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("base_url must use https://")
        return normalized


def parse_extra_providers(raw, local_mode=False):
    """Parse optional server-only provider JSON; bad entries are skipped safely."""
    if not raw:
        return []
    try:
        values = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(values, list):
            raise ValueError("must be a JSON array")
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        log.warning("Skipping EXTRA_AI_PROVIDERS_JSON: invalid JSON (%s)", exc)
        return []
    result = []
    for index, item in enumerate(values):
        try:
            if local_mode and isinstance(item, dict):
                url = str(item.get("base_url", ""))
                parsed_url = urlsplit(url)
                if parsed_url.scheme == "http" and parsed_url.hostname in {"localhost", "127.0.0.1"}:
                    item = {**item, "base_url": url.rstrip("/").replace("http://", "https://", 1)}
                    # Keep local URLs usable without weakening production validation.
                    parsed = ExtraProviderConfig.model_validate(item)
                    object.__setattr__(parsed, "base_url", url.rstrip("/"))
                else:
                    parsed = ExtraProviderConfig.model_validate(item)
            else:
                parsed = ExtraProviderConfig.model_validate(item)
            if parsed.enabled:
                result.append(parsed)
        except (TypeError, ValueError, ValidationError) as exc:
            log.warning(
                "Skipping extra AI provider at index %s: invalid configuration (%s)",
                index,
                type(exc).__name__,
            )
    return result


class AIUnavailable(ValueError):
    def __init__(
        self,
        message="Free AI providers are temporarily unavailable. Your request can be retried later.",
        retry_after=60,
    ):
        super().__init__(message)
        self.retry_after = max(1, min(int(retry_after), 86400))


class AIRefused(ValueError):
    pass


@dataclass(frozen=True)
class Provider:
    name: str
    model: str
    key: str
    daily_limit: int
    base_url: str = ""
    extra_headers: dict = None
    timeout_seconds: int = 45


class OpenAICompatibleClient:
    """Small server-side adapter shared by every /chat/completions provider."""

    def __init__(self, provider, transport=None):
        self.provider = provider
        self.transport = transport

    def complete(
        self,
        messages,
        temperature=0.2,
        max_tokens=2400,
        response_format=None,
        extra_payload=None,
        timeout_seconds=None,
        stream=False,
    ):
        payload = {
            "model": self.provider.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format is not None:
            payload["response_format"] = response_format
        if extra_payload:
            payload.update(extra_payload)
        if stream:
            payload["stream"] = True
        headers = {
            **(self.provider.extra_headers or {}),
            "Authorization": f"Bearer {self.provider.key}",
        }
        with httpx.Client(
            transport=self.transport,
            timeout=httpx.Timeout(
                timeout_seconds or self.provider.timeout_seconds,
                connect=min(10, timeout_seconds or self.provider.timeout_seconds),
            ),
            verify=ssl.create_default_context(),
            follow_redirects=False,
        ) as client:
            if stream:
                with client.stream(
                    "POST",
                    f"{self.provider.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                ) as response:
                    response_headers = dict(response.headers)
                    if response.status_code != 200:
                        return httpx.Response(
                            response.status_code,
                            headers=response_headers,
                            content=response.read(),
                        )
                    content_type = response.headers.get("content-type", "")
                    if "text/event-stream" not in content_type:
                        return httpx.Response(
                            response.status_code,
                            headers=response_headers,
                            content=response.read(),
                        )
                    content = []
                    finish_reason = "stop"
                    try:
                        for line in response.iter_lines():
                            if not line.startswith("data:"):
                                continue
                            event = line[5:].strip()
                            if event == "[DONE]":
                                break
                            chunk = json.loads(event)
                            choice = chunk.get("choices", [{}])[0]
                            delta = choice.get("delta", {}).get("content", "")
                            if delta:
                                content.append(delta)
                            if choice.get("finish_reason"):
                                finish_reason = choice["finish_reason"]
                    except (json.JSONDecodeError, IndexError, TypeError) as exc:
                        raise httpx.DecodingError("Invalid OpenAI-compatible stream", request=response.request) from exc
                    return httpx.Response(
                        200,
                        headers=response_headers,
                        json={"choices": [{"finish_reason": finish_reason, "message": {"content": "".join(content)}}]},
                    )
            return client.post(
                f"{self.provider.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )


class Gateway:
    OWNER = "__ai_gateway__"

    def __init__(self, settings, repo, transport=None, clock=time.time):
        self.settings, self.repo, self.transport, self.clock = (
            settings,
            repo,
            transport,
            clock,
        )
        self.lock = threading.RLock()
        self.providers = []
        self.model_checks = {}
        self.problem = ""
        if not settings.ai_enabled:
            self.problem = "AI is disabled on this server."
            return
        if not any(
            (
                settings.groq_api_key,
                settings.openrouter_api_key,
                settings.cloudflare_api_token,
                settings.freellmapi_api_key,
                settings.gemini_api_key,
                settings.cerebras_api_key,
                settings.nvidia_api_key,
                settings.extra_ai_providers_json,
            )
        ):
            self.problem = "Add a Groq, OpenRouter, or Cloudflare key to the server .env file to enable AI."
            return
        if not settings.ai_free_tier_confirmed:
            self.problem = "Confirm unbilled/free-plan provider accounts in the server configuration first."
            return
        if settings.freellmapi_enabled:
            if not settings.freellmapi_api_key:
                log.warning("Skipping FreeLLMAPI: FREELLMAPI_API_KEY is missing")
            elif not settings.freellmapi_model.strip():
                log.warning("Skipping FreeLLMAPI: FREELLMAPI_MODEL is empty")
            elif not settings.freellmapi_free_tier_confirmed:
                log.warning("Skipping FreeLLMAPI: free-tier confirmation is required")
            else:
                parsed_url = urlsplit(settings.freellmapi_base_url.rstrip("/"))
                local_router = parsed_url.hostname in {"localhost", "127.0.0.1"}
                if parsed_url.scheme != "https" and not (
                    settings.data_backend == "sqlite"
                    and os.getenv("VERCEL") != "1"
                    and parsed_url.scheme == "http"
                    and local_router
                ):
                    log.warning("Skipping FreeLLMAPI: base URL must use HTTPS outside local development")
                elif not parsed_url.hostname or parsed_url.username or parsed_url.password or parsed_url.query or parsed_url.fragment:
                    log.warning("Skipping FreeLLMAPI: invalid base URL")
                else:
                    self.providers.append(
                        Provider(
                            "freellmapi",
                            settings.freellmapi_model,
                            settings.freellmapi_api_key,
                            settings.ai_daily_requests,
                            settings.freellmapi_base_url.rstrip("/"),
                            {},
                            settings.ai_request_timeout_seconds,
                        )
                    )
        if settings.groq_api_key:
            if settings.groq_model not in {"openai/gpt-oss-120b", "openai/gpt-oss-20b"}:
                self.problem = "Groq model is outside the approved free-plan allowlist."
                return
            self.providers.append(
                Provider(
                    "groq",
                    settings.groq_model,
                    settings.groq_api_key,
                    settings.ai_daily_requests,
                    "https://api.groq.com/openai/v1",
                    {},
                    settings.ai_request_timeout_seconds,
                )
            )
        if settings.openrouter_api_key:
            model = settings.openrouter_model
            if (
                not model.endswith(":free")
                or model.count(":") != 1
                or ":online" in model
            ):
                self.problem = "OpenRouter requires an explicit :free model. Paid fallback models are not allowed."
                return
            self.providers.append(
                Provider(
                    "openrouter",
                    model,
                    settings.openrouter_api_key,
                    min(40, settings.ai_daily_requests),
                    "https://openrouter.ai/api/v1",
                    {},
                    settings.ai_request_timeout_seconds,
                )
            )
        if (
            settings.cloudflare_api_token
            and not settings.cloudflare_free_tier_confirmed
            and not self.providers
        ):
            self.problem = "Confirm Cloudflare Workers Free (no paid plan or prepaid AI Gateway billing) before enabling Cloudflare."
            return
        if settings.cloudflare_api_token and settings.cloudflare_free_tier_confirmed:
            if not re.fullmatch(r"[a-fA-F0-9]{32}", settings.cloudflare_account_id):
                self.problem = "Cloudflare requires a valid 32-character account ID."
                return
            if settings.cloudflare_model != "@cf/meta/llama-3.3-70b-instruct-fp8-fast":
                self.problem = (
                    "Cloudflare model is outside the approved Workers Free allowlist."
                )
                return
            self.providers.append(
                Provider(
                    "cloudflare",
                    settings.cloudflare_model,
                    settings.cloudflare_api_token,
                    settings.ai_daily_requests,
                    f"https://api.cloudflare.com/client/v4/accounts/{settings.cloudflare_account_id}/ai/v1",
                    {},
                    settings.ai_request_timeout_seconds,
                )
            )
        builtin = (
            ("gemini", settings.gemini_api_key, settings.gemini_base_url, settings.gemini_model),
            ("cerebras", settings.cerebras_api_key, settings.cerebras_base_url, settings.cerebras_model),
            ("nvidia", settings.nvidia_api_key, settings.nvidia_base_url, settings.nvidia_model),
        )
        for name, key, base_url, model in builtin:
            if key:
                self.providers.append(Provider(name, model, key, settings.ai_daily_requests, base_url.rstrip("/"), {}, settings.ai_request_timeout_seconds))
        existing = {p.name for p in self.providers}
        for extra in parse_extra_providers(
            settings.extra_ai_providers_json,
            local_mode=settings.auth_mode == "local" and settings.data_backend == "sqlite",
        ):
            if extra.name in existing:
                log.warning("Skipping extra AI provider %s: duplicate provider name", extra.name)
                continue
            self.providers.append(Provider(extra.name, extra.model, extra.api_key, settings.ai_daily_requests, extra.base_url, extra.extra_headers, extra.timeout_seconds))
            existing.add(extra.name)
        order = [name.strip() for name in settings.ai_provider_order.split(",") if name.strip()]
        if order:
            by_name = {p.name: p for p in self.providers}
            self.providers = [by_name[name] for name in order if name in by_name]
            self.providers += [p for p in by_name.values() if p.name not in order]
        if not self.providers:
            self.problem = "Add a Groq, OpenRouter, or Cloudflare key to the server .env file to enable AI."

    @property
    def configured(self):
        return bool(self.providers) and not self.problem

    def require(self):
        if not self.configured:
            raise ValueError(self.problem)

    def fingerprint(self, provider):
        return hashlib.sha256((provider.model + provider.key).encode()).hexdigest()

    def state(self, provider):
        value = self.repo.get(self.OWNER, "providers", provider.name) or {
            "id": provider.name
        }
        fingerprint = self.fingerprint(provider)
        if value.get("fingerprint") != fingerprint:
            value = {
                "id": provider.name,
                "revision": value.get("revision", 0),
                "fingerprint": fingerprint,
            }
        day = datetime.fromtimestamp(self.clock(), timezone.utc).date().isoformat()
        if value.get("day") != day:
            value.update(day=day, used=0)
        return value

    def reserve(self, provider):
        # CAS also protects shared quotas across multiple Python/Celery processes.
        from ..repository import Conflict

        for _ in range(8):
            value = self.state(provider)
            if value.get("retry_at", 0) > self.clock():
                return False
            if value.get("used", 0) >= provider.daily_limit:
                return False
            try:
                self.repo.put(
                    self.OWNER,
                    "providers",
                    {**value, "used": value.get("used", 0) + 1, "disabled": False},
                    expected=value.get("revision", 0),
                )
                return True
            except Conflict:
                continue
        return False

    def cooldown(self, provider, seconds=60, disabled=False, reason="unavailable"):
        from ..repository import Conflict

        for _ in range(8):
            value = self.state(provider)
            try:
                self.repo.put(
                    self.OWNER,
                    "providers",
                    {
                        **value,
                        "retry_at": max(
                            value.get("retry_at", 0), self.clock() + seconds
                        ),
                        "disabled": disabled,
                        "failure_reason": reason,
                    },
                    expected=value.get("revision", 0),
                )
                return
            except Conflict:
                continue

    def record_health(self, provider, *, latency_ms=None, status=None, failure=None):
        from ..repository import Conflict

        for _ in range(8):
            value = self.state(provider)
            update = {
                **value,
                "health": "unavailable" if failure else "healthy",
                "last_status": status,
                "failure_count": value.get("failure_count", 0) + 1 if failure else 0,
            }
            if latency_ms is not None:
                update["last_latency_ms"] = latency_ms
            if failure:
                update["failure_reason"] = failure
            else:
                update.pop("failure_reason", None)
                update.pop("retry_at", None)
                update["disabled"] = False
            try:
                self.repo.put(self.OWNER, "providers", update, expected=value.get("revision", 0))
                return
            except Conflict:
                continue

    def status(self):
        providers = []
        for p in self.providers if self.configured else []:
            value = self.state(p)
            provider_status = {
                    "name": p.name,
                    "model": p.model,
                    "requests_used": value.get("used", 0),
                    "daily_cap": p.daily_limit,
                    "retry_at": value.get("retry_at"),
                    "disabled": bool(value.get("disabled") and value.get("retry_at", 0) > self.clock()),
                    "health": value.get("health", "unknown"),
                    "failure_count": value.get("failure_count", 0),
                    "last_latency_ms": value.get("last_latency_ms"),
                }
            if p.name == "freellmapi" and (p.base_url, p.model) in self.model_checks:
                provider_status["model_verified"] = self.model_checks[(p.base_url, p.model)][1]
            providers.append(provider_status)
        state = "unconfigured"
        message = self.problem
        retry_at = None
        if self.configured:
            now = self.clock()
            usable = [
                p
                for p in providers
                if not p["disabled"]
                and p["requests_used"] < p["daily_cap"]
                and not (p["retry_at"] or 0) > now
            ]
            retry_times = [
                p["retry_at"]
                for p in providers
                if p["retry_at"] and p["retry_at"] > now
            ]
            retry_at = min(retry_times) if retry_times else None
            if usable:
                state = "ready"
                message = "Free-tier AI is ready. Provider quotas may still apply."
            elif all(p["disabled"] for p in providers):
                state = "disabled"
                message = "The configured AI providers need attention. Check the server keys and provider access."
            else:
                state = "cooling_down"
                message = "Free-tier AI is cooling down. Retry when the provider quota resets."
        return {
            "configured": self.configured,
            "state": state,
            "free_only": True,
            "message": message,
            "retry_at": retry_at,
            "providers": providers,
        }

    def retry_seconds(self, response):
        raw = response.headers.get("retry-after", "60")
        try:
            return max(1, min(86400, int(float(raw))))
        except ValueError:
            try:
                return max(
                    1,
                    min(
                        86400,
                        int(parsedate_to_datetime(raw).timestamp() - self.clock()),
                    ),
                )
            except (ValueError, TypeError, OverflowError):
                return 60

    def request(self, provider, instructions, prompt, schema=None, max_tokens=None, timeout_seconds=None):
        max_tokens = max_tokens or self.settings.ai_max_output_tokens
        deadline = time.monotonic() + timeout_seconds if timeout_seconds else None
        messages = [
                {"role": "system", "content": instructions},
                {"role": "user", "content": prompt},
            ]
        response_format = {"type": "json_object"}
        if provider.name == "freellmapi" and schema is not None:
            strict_schema = schema.model_json_schema()

            def require_fields(node):
                if isinstance(node, dict):
                    if node.get("type") == "object" and "properties" in node:
                        node["required"] = list(node["properties"])
                        node["additionalProperties"] = False
                    for child in node.values():
                        require_fields(child)
                elif isinstance(node, list):
                    for child in node:
                        require_fields(child)

            require_fields(strict_schema)
            response_format = {
                "type": "json_schema",
                "json_schema": {
                    "name": schema.__name__,
                    "strict": True,
                    "schema": strict_schema,
                },
            }
        if provider.name == "freellmapi":
            model_key = (provider.base_url, provider.model)
            model_check = self.model_checks.get(model_key)
            if model_check is None or time.monotonic() - model_check[0] >= 300:
                model_available = self.check_model(provider, timeout_seconds)
                self.model_checks[model_key] = (time.monotonic(), model_available)
            else:
                model_available = model_check[1]
            if model_available is False:
                return httpx.Response(404, json={"error": "Configured model is unavailable"})
            if deadline is not None:
                timeout_seconds = deadline - time.monotonic()
                if timeout_seconds <= 0:
                    return httpx.Response(408, json={"error": "Provider timeout"})
        extra_payload = {}
        if provider.name == "groq":
            extra_payload["reasoning_effort"] = "low"
        elif provider.name == "openrouter":
            extra_payload["provider"] = {
                "max_price": {"prompt": 0, "completion": 0, "request": 0},
                "allow_fallbacks": False,
            }
        return OpenAICompatibleClient(provider, self.transport).complete(
            messages,
            temperature=0.2,
            max_tokens=max_tokens,
            response_format=response_format,
            extra_payload=extra_payload,
            timeout_seconds=timeout_seconds,
            stream=provider.name == "freellmapi",
        )

    def check_model(self, provider, timeout_seconds=None):
        """Return availability when /models is supported, otherwise leave it unverified."""
        client_timeout = min(5, timeout_seconds or provider.timeout_seconds)
        headers = {"Authorization": f"Bearer {provider.key}"}
        try:
            with httpx.Client(
                transport=self.transport,
                timeout=httpx.Timeout(client_timeout, connect=min(3, client_timeout)),
                verify=ssl.create_default_context(),
                follow_redirects=False,
            ) as client:
                response = client.get(f"{provider.base_url}/models", headers=headers)
            if response.status_code != 200:
                return None
            models = response.json().get("data")
            if not isinstance(models, list):
                return None
            return provider.model == "auto" or any(
                isinstance(model, dict) and model.get("id") == provider.model
                for model in models
            )
        except (httpx.HTTPError, ValueError, TypeError):
            return None

    def complete(self, schema, system, prompt, validate=None, max_tokens=None):
        self.require()
        check = getattr(self, "permission_check", None)
        if check and not any(check(p.name) for p in self.providers):
            raise ValueError(
                "AI sharing permission changed. Please review your provider permissions."
            )
        instructions = (
            system
            + "\nReturn ONLY one JSON object matching this schema. Do not wrap it in markdown.\n"
            + json.dumps(schema.model_json_schema())
        )
        retry = []
        invalid_output = False
        started = self.clock()
        attempts = 0
        for p in self.providers:
            remaining = self.settings.ai_request_timeout_seconds - (self.clock() - started)
            if attempts >= self.settings.ai_max_failover_attempts or remaining <= 0:
                break
            if check and not check(p.name):
                continue
            with self.lock:
                if not self.reserve(p):
                    value = self.state(p)
                    invalid_output |= value.get("failure_reason") == "invalid_output"
                    retry.append(
                        max(
                            60,
                            value.get("retry_at", self.clock() + 3600) - self.clock(),
                        )
                    )
                    continue
            provider_started = self.clock()
            try:
                attempts += 1
                response = self.request(
                    p,
                    instructions,
                    prompt,
                    schema,
                    max_tokens,
                    timeout_seconds=max(1, min(p.timeout_seconds, remaining)),
                )
            except httpx.HTTPError:
                self.record_health(
                    p,
                    latency_ms=round((self.clock() - provider_started) * 1000),
                    failure="network",
                )
                self.cooldown(p, 60, reason="network")
                retry.append(60)
                continue
            if response.status_code in (401, 403):
                self.record_health(p, latency_ms=round((self.clock() - provider_started) * 1000), status=response.status_code, failure="authentication")
                self.cooldown(p, 300, reason="authentication")
                retry.append(300)
                continue
            if response.status_code == 429 or response.status_code >= 500:
                seconds = self.retry_seconds(response)
                self.record_health(p, latency_ms=round((self.clock() - provider_started) * 1000), status=response.status_code, failure="upstream")
                self.cooldown(p, seconds)
                retry.append(seconds)
                continue
            if response.status_code != 200:
                # Never expose provider error bodies (which may echo credentials/prompts).
                self.record_health(p, latency_ms=round((self.clock() - provider_started) * 1000), status=response.status_code, failure="upstream")
                self.cooldown(p, 300, reason="upstream")
                retry.append(300)
                continue
            try:
                data = response.json()
                choice = data["choices"][0]
                if choice.get("finish_reason") == "content_filter":
                    self.record_health(p, latency_ms=round((self.clock() - provider_started) * 1000), status=response.status_code)
                    raise AIRefused(
                        "The provider declined this request. Try a different study question."
                    )
                if choice.get("finish_reason") != "stop":
                    raise ValueError("Incomplete answer")
                raw = choice["message"]["content"]
                result = schema.model_validate_json(raw).model_dump()
                if validate:
                    validate(result)
                result["_ai"] = {"provider": p.name, "model": p.model}
                self.record_health(
                    p,
                    latency_ms=round((self.clock() - provider_started) * 1000),
                    status=response.status_code,
                )
                return result
            except AIRefused:
                raise
            except (ValueError, ValidationError, KeyError, IndexError, TypeError):
                invalid_output = True
                self.record_health(p, latency_ms=round((self.clock() - provider_started) * 1000), status=response.status_code, failure="invalid_output")
                self.cooldown(p, 15, reason="invalid_output")
                retry.append(15)
        if invalid_output:
            raise AIUnavailable(
                "The AI response did not pass source or format checks. Your request is saved for another attempt.",
                retry_after=min(retry or [60]),
            )
        raise AIUnavailable(retry_after=min(retry or [60]))
