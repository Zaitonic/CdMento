# Free AI setup for CdMento

CdMento can route through **Groq, an optional OpenRouter free model, Cloudflare Workers AI, or the local FreeLLMAPI/Mistral prototype**. Providers are chosen automatically; the gateway falls through to the next configured provider when one reaches its free quota or has a temporary failure. Uploading/extracting/reading documents stays local to the backend and does not call a provider.

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


## Local FreeLLMAPI prototype

CdMento can send requests to the separately running router at `http://127.0.0.1:3001/v1`.
Set `FREELLMAPI_API_KEY` to the router's unified key (not a provider key),
`FREELLMAPI_MODEL=ministral-8b-latest`, and `FREELLMAPI_FREE_TIER_CONFIRMED=true`
only after confirming the upstream Mistral account is unbilled Free/Experiment mode.
The router must remain local and its Mistral model route must remain restricted to Mistral.
CdMento displays this route as Mistral. Provider selection is automatic.
Unrestricted `auto` and remote router URLs are rejected. Other configured direct routes remain available.
The router key stays on the Python server; the browser never receives it.

Structured JSON and existing source quote checks remain mandatory. Unsupported responses fail safely.
The router's current model catalog permits two requests per minute for this model; coding tools and
CdMento share that allowance. A new key on the same upstream account does not create extra capacity.
Existing job cooldown/retry behavior respects rate limits. Do not increase catalog limits to bypass quotas.
The router's advertised billions of tokens are aggregate catalog allowances, not this workspace's quota.
This remains a local prototype: no production readiness, security audit, or concurrent-user capacity is implied.

Live reviewer output from the pinned Mistral model included unsupported examples despite valid citations. Mistral is therefore excluded from reviewer generation. Reviewers use other configured providers, or stop before transmitting material when none is available. Chat, cards, quizzes, and maps remain available through Mistral.
