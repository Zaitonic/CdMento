"""Free-tier provider routing. Secrets and original files never enter public responses."""

import hashlib
import json
import re
import ssl
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import httpx
from pydantic import ValidationError


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
            )
        ):
            self.problem = "Add a Groq, OpenRouter, or Cloudflare key to the server .env file to enable AI."
            return
        if not settings.ai_free_tier_confirmed:
            self.problem = "Confirm unbilled/free-plan provider accounts in the server configuration first."
            return
        if settings.freellmapi_api_key:
            if not settings.freellmapi_free_tier_confirmed:
                self.problem = "Confirm the router uses an unbilled Mistral free account before enabling it."
                return
            if settings.freellmapi_base_url != "http://127.0.0.1:3001/v1":
                self.problem = (
                    "The experimental router must use the approved loopback endpoint."
                )
                return
            if settings.freellmapi_model != "ministral-8b-latest":
                self.problem = "Use the tested pinned Mistral model; automatic cross-provider routing is not allowed."
                return
            self.providers.append(
                Provider(
                    "mistral",
                    settings.freellmapi_model,
                    settings.freellmapi_api_key,
                    settings.ai_daily_requests,
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
                )
            )
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
            if value.get("disabled") or value.get("retry_at", 0) > self.clock():
                return False
            if value.get("used", 0) >= provider.daily_limit:
                return False
            try:
                self.repo.put(
                    self.OWNER,
                    "providers",
                    {**value, "used": value.get("used", 0) + 1},
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

    def status(self):
        providers = []
        for p in self.providers if self.configured else []:
            value = self.state(p)
            providers.append(
                {
                    "name": p.name,
                    "model": p.model,
                    "requests_used": value.get("used", 0),
                    "daily_cap": p.daily_limit,
                    "retry_at": value.get("retry_at"),
                    "disabled": bool(value.get("disabled")),
                }
            )
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

    def request(self, provider, instructions, prompt, schema=None):
        max_tokens = self.settings.ai_max_output_tokens
        urls = {
            "mistral": f"{self.settings.freellmapi_base_url}/chat/completions",
            "groq": "https://api.groq.com/openai/v1/chat/completions",
            "openrouter": "https://openrouter.ai/api/v1/chat/completions",
            "cloudflare": f"https://api.cloudflare.com/client/v4/accounts/{self.settings.cloudflare_account_id}/ai/v1/chat/completions",
        }
        url = urls[provider.name]
        headers = {"Authorization": f"Bearer {provider.key}"}
        payload = {
            "model": provider.model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": prompt},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
        if provider.name == "mistral" and schema is not None:
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
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": schema.__name__,
                    "strict": True,
                    "schema": strict_schema,
                },
            }
        if provider.name == "groq":
            payload["reasoning_effort"] = "low"
        elif provider.name == "openrouter":
            payload["provider"] = {
                "max_price": {"prompt": 0, "completion": 0, "request": 0},
                "allow_fallbacks": False,
            }
        with httpx.Client(
            transport=self.transport,
            timeout=httpx.Timeout(45, connect=10),
            verify=ssl.create_default_context(),
            follow_redirects=False,
        ) as client:
            return client.post(url, headers=headers, json=payload)

    def complete(self, schema, system, prompt, validate=None):
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
        for p in self.providers:
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
            try:
                response = self.request(p, instructions, prompt, schema)
            except httpx.HTTPError:
                self.cooldown(p, 30)
                retry.append(30)
                continue
            if response.status_code in (401, 403):
                self.cooldown(p, 86400, disabled=True)
                retry.append(86400)
                continue
            if response.status_code == 429 or response.status_code >= 500:
                seconds = self.retry_seconds(response)
                self.cooldown(p, seconds)
                retry.append(seconds)
                continue
            if response.status_code != 200:
                # Never expose provider error bodies (which may echo credentials/prompts).
                self.cooldown(p, 300)
                retry.append(300)
                continue
            try:
                data = response.json()
                choice = data["choices"][0]
                if choice.get("finish_reason") == "content_filter":
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
                return result
            except AIRefused:
                raise
            except (ValueError, ValidationError, KeyError, IndexError, TypeError):
                invalid_output = True
                self.cooldown(p, 15, reason="invalid_output")
                retry.append(15)
        if invalid_output:
            raise AIUnavailable(
                "The AI response did not pass source or format checks. Your request is saved for another attempt.",
                retry_after=min(retry or [60]),
            )
        raise AIUnavailable(retry_after=min(retry or [60]))
