# Free AI setup for CdMento

CdMento can route through **Groq, OpenRouter, Cloudflare Workers AI, FreeLLMAPI, Google AI Studio (Gemini), Cerebras, NVIDIA NIM, and any number of additional OpenAI-compatible endpoints**. Providers are chosen in configured order and fall through when one reaches its quota or has a temporary failure. Uploading/extracting/reading documents stays local to the backend and does not call a provider.

## Configure your own keys

1. Create keys in your own accounts: [Groq Console](https://console.groq.com/keys), [OpenRouter](https://openrouter.ai/settings/keys), or [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/).
2. Keep Groq on its **Free Plan** and Cloudflare on **Workers Free**. Review current eligibility, model pricing and quotas in those accounts.
3. Copy `.env.example` to `.env` if it does not exist. Enter keys only into the server file:

```dotenv
AI_ENABLED=true
AI_FREE_TIER_CONFIRMED=true
GROQ_API_KEY=your-own-key
GROQ_MODEL=openai/gpt-oss-120b
# Optional: choose an actual currently listed free model variant.
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
AI_DAILY_REQUESTS=100
AI_MAX_OUTPUT_TOKENS=2400
```

Use only the providers you want: blank keys are skipped. `AI_FREE_TIER_CONFIRMED=true` is the administrator's confirmation that direct-provider credentials belong to unbilled/free-plan accounts. The app cannot independently inspect provider billing status, and an allowlisted model can still incur costs if you attach a paid account. Leave this flag false until you have checked account billing. The model allowlists are deliberately narrow; review published pricing before changing them. `OPENAI_API_KEY` is ignored by the new gateway.

4. Restart `npm run dev:all` (or the API and any Celery workers). Sign in, add a readable source, and create a reviewer or ask a question. CdMento selects the first available provider and switches automatically when quota runs out.
5. Never put keys in React, a `VITE_` variable, browser storage, screenshots, or chat messages. `.env` is ignored by source control. Set `AI_ENABLED=false` to turn off new provider calls.

## Additional OpenAI-compatible providers

The built-in Gemini, Cerebras, and NVIDIA presets activate only when their server-side key is set. You can add unlimited compatible providers (including Cohere, Hugging Face, SambaNova, GitHub Models, or a hosted FreeLLMAPI) with one JSON array:

```dotenv
AI_PROVIDER_ORDER=groq,gemini,backup-provider
EXTRA_AI_PROVIDERS_JSON=[{"name":"backup-provider","base_url":"https://example.com/v1","api_key":"server-only-key","model":"my-model","enabled":true,"timeout_seconds":30,"extra_headers":{"X-Provider":"cdmento"}}]
```

URLs must use `https://` outside local development. In local mode only, `http://localhost/...` and `http://127.0.0.1/...` are allowed for local routers. Invalid entries are logged by name/index and skipped. Keys are never returned by the status endpoint or sent to the frontend. `AI_PROVIDER_ORDER` prioritizes named providers; all other enabled providers are appended automatically.

The gateway caps failover attempts and total request time. Timeouts/network errors and 429/5xx responses use a short cooldown; authentication, payment, and permission failures use a longer cooldown. Upstream response bodies are not exposed to clients.

## Cost and privacy controls

### Optional Cloudflare Workers AI backup

Cloudflare supports the same grounded chat, reviewer, flashcard, quiz, and map generation through its OpenAI-compatible API. Configure `CLOUDFLARE_API_TOKEN` and the 32-character `CLOUDFLARE_ACCOUNT_ID` on the server. Use a token scoped to Workers AI for that account, rather than a global API key. The allowlisted model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Confirm that the account uses **Workers Free**, without prepaid/unified AI Gateway billing, before setting `CLOUDFLARE_FREE_TIER_CONFIRMED=true`. The existing `AI_FREE_TIER_CONFIRMED` check also applies. Credentials are optional and blank by default.

Cloudflare is tried after the existing providers. It uses the same context, citation validation, request caps, and retry jobs. Its 10,000-neuron daily provider allowance is separate from CdMento's request counter; only Cloudflare can enforce the actual neuron quota. Workers Free rejects requests past its free allocation. Upgrading the account to a paid plan can enable overage charges; disable this connector and clear its confirmation flag before any billing change. No Worker deployment, paid model, unified billing, or local model download is needed.

References: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [OpenAI-compatible endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/), [data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/).

Mistral and Cohere are not configured by this connector. Mistral account availability and free quota need a live account check. Cohere trial keys are intended for evaluation/prototyping, not a replacement for production access.

- Only allowlisted Groq/Cloudflare models and explicit OpenRouter `:free` variants are accepted. OpenRouter requests set a zero prompt/completion/request price ceiling and disable provider fallbacks. No paid model or tool is silently substituted.
- No hosted vector stores, cloud file-search storage, web search, or automatic uploads to AI. The original PDF stays in application storage; providers receive selected extracted text and relevant chat context.
- Each provider has its own free-tier retention and training policies. The app discloses that material may be processed by the configured providers, and provider selection plus failover are automatic.
- Persisted provider counters enforce a conservative application cap across users/processes. These are application counters, not a promise of remaining provider quota. Provider rate limits still apply; provider account settings are authoritative.

## Reviewer and conversation behavior

Reviewers cover all readable text within the selected source/page range, up to 64,000 extracted characters per request. Larger selections are rejected with a request to choose a smaller chapter/page range rather than silently truncated. Generation proceeds in bounded parts with durable checkpoints. Each generated section and practice answer needs an exact source quote and page/section reference; unsupported quotes are rejected. An exact quote check does not prove an interpretation is correct. Blank/scanned pages are explicitly listed as unreviewed. Scanned pages are recognized locally using bundled OCR models; any remaining unreadable pages are flagged. OCR does not call an AI provider.

Chat retrieves a small local set of relevant passages, includes recent messages and a bounded local summary of older turns, and sends that same context if a provider switches. It is not unlimited conversation memory. No provider-specific conversation ID is needed. Cards/quizzes/maps use relevant passages and do not claim full-document coverage.

`429`, timeouts, and temporary provider errors trigger automatic provider fallback and cooldowns. If all providers are unavailable, generation/chat requests wait durably and show a retry time. Up to five automatic retries are allowed; persistent failures become retryable failed jobs. Reviewers resume from completed parts. A provider safety refusal is shown without trying another provider to bypass it.

## Verification

### Teaching behavior

The default tutor uses simple English, clear source examples, and concise answers. Ordinary chat starts with a direct answer (usually under 100 words), adds detail when requested, and avoids the old thesis/evidence/analysis template. Citations remain separate clickable references; internal IDs should not appear in explanations. Follow-ups should address the new question briefly. Reviewers and generated practice material use the same plain-language rules.

These changes tune prompts, not provider model weights. Uploads are reference material, not training data. No student files are collected for fine-tuning. Saved conversations and artifacts remain unchanged; the prompt revision invalidates generation caches for new requests. Test cases in `backend/tests/fixtures/study_tutor_cases.json` cover a definition, missing evidence, a malicious embedded instruction, and a short follow-up. Live evaluations use only these synthetic notes. They provide spot checks, not a guarantee of correctness for every document or model response.

Automated tests use HTTPX mock transports: no live keys, paid calls, or student-data transmission. They cover zero-price routing, no automatic document transmission, unsupported citations, context handoff, persisted budgets/cooldowns, queued chat, reviewer checkpoint recovery, permission revocation, and saving reviewers to Notes.

Live output quality, real account quotas, and account billing eligibility still require verification after you supply your own keys. Redis/Celery deployment needs its own live verification; local SQLite worker mode is used during development.


## FreeLLMAPI

FreeLLMAPI is an optional OpenAI-compatible provider. Install and run it separately using its
[official install guide](https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/install/01-install.md).
The upstream project documents Docker Compose and Windows setup, and serves its API on port 3001.
Create provider keys in its dashboard, then copy its **unified API key** (not an upstream provider key)
into CdMento's backend environment. Never put it in a `VITE_` variable.

```dotenv
AI_ENABLED=true
AI_FREE_TIER_CONFIRMED=true
FREELLMAPI_ENABLED=true
FREELLMAPI_API_KEY=freellmapi-your-unified-key
FREELLMAPI_BASE_URL=http://127.0.0.1:3001/v1
FREELLMAPI_MODEL=ministral-8b-latest
FREELLMAPI_FREE_TIER_CONFIRMED=true
AI_PROVIDER_ORDER=cloudflare,freellmapi,groq,openrouter
```

The provider order is a priority list; other configured providers are appended automatically.
Restart the backend after changing environment values. Before choosing the model, check the proxy's
actual catalog with `GET /v1/models` and use an ID returned by that server. CdMento checks this list
when available; if the endpoint is unsupported, model validation is deferred to the completion
request and failures fall through safely. FreeLLMAPI's OpenAI-compatible streaming responses are
collected server-side so CdMento can continue validating complete structured JSON before returning it.

`127.0.0.1` works when CdMento's backend and FreeLLMAPI run on the same host. If the backend is in a
container, its loopback is the container; configure a host-reachable URL such as
`http://host.docker.internal:3001/v1` and make sure the FreeLLMAPI listener accepts that connection.
Do not expose the proxy dashboard or unified key to the public internet. Vercel cannot reach a
developer computer's loopback address: a Vercel deployment would require a separately hosted,
HTTPS-reachable proxy URL and a server-side key. The upstream FreeLLMAPI project describes itself as
single-user and intended for personal experimentation, not production; review provider terms and
the proxy's security posture before routing a multi-user CdMento deployment through it.

The API key remains on the backend. Provider status reports recent health, latency, cooldowns, and
failure counts without returning credentials or raw upstream error bodies. No live proxy connection
is claimed unless a running instance is reachable and verified.

### Windows Docker Compose quick start

From PowerShell, follow the upstream Compose setup and generate a fresh encryption key for the
proxy's local key database:

```powershell
git clone https://github.com/tashfeenahmed/freellmapi.git
Set-Location freellmapi
$bytes = New-Object Byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$encryptionKey = -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
@("ENCRYPTION_KEY=$encryptionKey", 'PORT=3001') | Set-Content -Encoding ascii .env
docker compose up -d
```

Open `http://localhost:3001`, configure upstream keys in its dashboard, and copy the unified API
key into CdMento's backend `.env`. Check that the selected model appears in `/v1/models` before
using it. Stop the proxy with `docker compose down` (without `-v` to preserve its data volume),
and view logs with `docker compose logs -f freellmapi`.
