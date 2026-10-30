# CdMento: free-only AI integration plan

Planning only. Checked against official provider documentation on 25 October 2026. This supersedes the previous paid-model recommendation; it does not switch the running backend to free providers yet.

## Requirement

Use free inference tiers only. No automatic paid fallback, credit purchases, paid subscriptions as a prerequisite, or reliance on a temporary promotional balance for normal operation. Free capacity is finite; when every approved provider is exhausted, preserve the request and wait for a reset, or use an explicitly configured local model.

## Provider findings

| Provider | Finding | Proposed status |
|---|---|---|
| Google Gemini API | Selected models have a documented free API tier. Gemini 3.5 Flash-Lite is listed with free-tier input/output. Model access and active quota depend on the project/account. | Primary candidate, after verifying the actual account is on the free tier |
| Groq API | A Free plan is documented with model-specific request/token limits. Its available free models include open-weight GPT-OSS models. | Backup candidate, after checking free-plan model availability |
| ChatGPT / OpenAI API | ChatGPT and standard API billing are separate. No general recurring free standard inference tier was established by the current API pricing documentation. Special grants/trials and paid-plan integrations are not an always-free foundation. | Disabled in the free-only router |
| Claude API | Standard model usage is priced. Current recurring subscriber API credits require eligible Max/Team plans; Free plans are excluded. Grants are conditional. | Disabled in the free-only router |
| Grok / xAI API | Current billing documentation describes prepaid/invoiced usage. An ongoing, generally available zero-spend API tier was not verified. Historical free-credit claims are not sufficient. | Disabled unless a current zero-spend entitlement is separately verified |

Groq and Grok are different services. GPT-OSS hosted by Groq is also different from using the ChatGPT website or OpenAI's paid hosted API.

## Initial route

Gemini 3.5 Flash-Lite on a verified free project -> Groq Free with a schema-capable approved model such as openai/gpt-oss-120b -> optionally a locally installed model -> wait for free quota to reset.

The final model order should be decided by a small source-grounded study evaluation, rather than assuming either provider always produces the better answer. Not every free model supports the same schema, context size, tools, images or output length.

Do not include two keys from one project as if they were independent capacity pools. Gemini limits are per project; Groq publishes organization-level limits. Multiple CdMento students share the backend's provider allowance.

## Conversation handoff

The providers do not hand messages directly to each other. CdMento owns the conversation and constructs a new request for the next provider:

- Stable internal conversation and message IDs.
- The current user question and study instructions.
- Recent user/assistant messages, preserved verbatim within budget.
- A saved factual summary of older conversation, including unresolved questions.
- Relevant passages from the user's selected notebook sources.
- App-owned source IDs and citation metadata.

Build the context to fit the next model's context window and remaining request/token budget. A summary helps continuity but is not lossless memory. Do not transfer hidden reasoning, provider-specific response IDs, or assume a provider's private vector store is accessible to another provider.

If the first provider fails before a complete answer is committed, retry the current turn with the approved backup. If partial output has already been displayed, label it interrupted and regenerate one coherent answer instead of joining unrelated model fragments. Persist exactly one successful assistant answer per request ID; retries and job recovery must not create duplicate quiz decks, cards or messages.

## Router behavior

Keep provider status, observed quota headers, token estimates, cooldown/reset time, recent errors and in-flight reservations on the Python backend. Reserve estimated capacity before sending concurrent requests. Treat provider quota headers and errors as authoritative when available; app counters alone cannot know usage from other applications on the same account.

- Short-term throttling: honor Retry-After/backoff; optionally use the next eligible provider for this turn.
- Daily/token quota exhaustion: put that provider into cooldown until the reported reset or a conservative retry time.
- Temporary timeout/server failure: bounded retry, then eligible fallback.
- Invalid key or permission error: disable that integration until its configuration is fixed.
- Context too large: reduce/retrieve context appropriately, without repeatedly resending the same oversized prompt.
- Safety refusal: handle the refusal; do not switch providers to evade it.
- All providers exhausted: return a clear retry state without charging or discarding conversation history.

## Enforcing free-only use

1. Use an unbilled Gemini API project and a Groq Free account; verify model eligibility in the actual dashboards before enabling the keys.
2. Keep a server-side allowlist of provider/model pairs verified as free for those accounts. A model's public free-tier listing does not make a paid account's calls free automatically.
3. Do not configure paid-provider fallback keys in this mode. Disable automatic recharge and paid upgrades; budget alerts are not a substitute for remaining on a free plan.
4. Replace the current OpenAI-hosted vector-store/file-search dependency with provider-independent Python retrieval, such as a local text/chunk index and optionally local embeddings. Avoid paid storage, embedding, search, caching and browsing tools in the AI path.
5. Generate cards/quizzes/maps using each provider's supported structured output method, then validate the same Pydantic schemas and source references in Python.
6. Keep routine grading, FSRS scheduling, timer updates and ordinary data operations outside the language model.
7. Cache generation results by source revision and settings to conserve free capacity.

This constrains AI API spending; local computing resources and the application's database/hosting are separate considerations. A local Ollama model has no hosted per-token inference bill but requires suitable hardware and a model with an appropriate license.

## Interface

- Keep one chat and its history when a provider changes.
- Show the active provider and a short message such as "Gemini reached its free limit. Continuing with Groq."
- Explain in account/settings UI which services may receive selected passages through automatic fallback.
- Google states free-tier content may be used to improve its products. Present the applicable provider terms before sending documents; do not imply free inference has the same data terms as a paid tier.
- When every free service is unavailable, show a saved conversation and retry/reset information. Never silently enable paid calls.

## Proposed implementation order after approval

1. Provider adapter interface and free-only configuration validation.
2. Gemini and Groq adapters, with mocked contract tests and real free-tier verification when keys are supplied.
3. Provider-independent retrieval and shared conversation context.
4. Quota-aware routing, cooldowns and idempotent handoff tests.
5. Structured-output compatibility for cards, quizzes and maps.
6. Provider status UI and all-providers-exhausted behavior.
7. Optional local fallback if the available hardware supports a useful model.

## Official references

- [Gemini pricing and free-tier eligibility](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini quotas](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Groq Free plan limits and rate-limit headers](https://console.groq.com/docs/rate-limits)
- [Groq billing tiers](https://console.groq.com/docs/billing-faqs)
- [Groq structured outputs](https://console.groq.com/docs/structured-outputs)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [Separate ChatGPT/API billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)
- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Claude subscriber credit eligibility](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)
- [xAI API billing](https://docs.x.ai/developers/faq/billing)
- [Ollama local/cloud API](https://docs.ollama.com/api/introduction)
