# CdMento Python backend plan

Planning draft — 25 October 2026. No backend migration has been implemented.

Implementation update: the Python backend is now implemented. This document preserves the approved planning discussion; see [README.md](../README.md) for the actual setup, local/cloud modes, delivered features, and remaining limitations.

## Direction

Keep the React interface. Replace Express with Python FastAPI. All application API requests and AI-provider connections go through Python. Keep Firebase Authentication, Firestore, and Storage as the initial managed services because adapters already exist in the frontend; this is a proposed continuation of the existing stack, not a configured cloud deployment.

Browser local storage becomes a migration source and optional cache, not the authoritative database. New users start with no notebooks, notes, sources, or generated material.

## What the code actually does today

| Feature | Current implementation | Backend work |
|---|---|---|
| Accounts | Optional Firebase email/password interface; requires project configuration | Verify tokens in Python; establish user identity and ownership checks |
| Notebooks | Local create, rename, delete, filter; active notebook ID | Persistent CRUD, authorization, deletion workflow, pagination |
| Sources | Browser extracts PDF/DOCX/TXT, 10 MB limit, extracted-text preview | Store originals, validate files, process text, track jobs, index for retrieval |
| AI assistant | Express forwards browser-supplied source text; conversation lives in memory | Server-owned source retrieval, saved conversations, citations, streaming, limits |
| Notes | Tiptap HTML saved locally | Tiptap JSON, autosave, revision checks, plain-text search |
| Flashcards | First two words removed from up to twelve source sentences | Grounded question/answer generation, editable decks, reviews and scheduling |
| Quizzes | Reuses sentence prompts and other sentence prefixes as choices; browser grades | Validated questions, server-held answer keys, attempts, explanations, grading |
| Mind maps | Notebook root linked to at most eight source filenames; layout resets | Editable graph persistence; optional concept/relation generation |
| Focus timer | React interval, reset on unmount; tasks in local storage | Persist sessions, deadlines, pause/resume state and user tasks |
| Search/export | Notebook-name filtering and device JSON download | Authorized search and complete workspace export |
| Cloud saves | Explicit browser-to-Firebase save/load of records and extracted text | Move business data access behind Python and import existing user work |

## Proposed services

- FastAPI, Uvicorn, Pydantic: REST API, validation, typed responses, OpenAPI documentation.
- Firebase Admin Python SDK: verify Firebase ID tokens; access Firestore and Cloud Storage from Python.
- pypdf for selectable PDF text, python-docx for DOCX paragraphs/tables, standard Python text decoding for TXT. Scanned PDFs require an explicit OCR stage; ordinary PDF extraction does not perform OCR.
- OpenAI Python SDK through an internal AI-provider adapter. Provider/model selection remains environment configuration. Secrets stay on the backend.
- OpenAI hosted file search for the first retrieval implementation, with a separate index per notebook and server-controlled source selection. It provides semantic/keyword retrieval and file citations. Do not promise page citations when only filenames are returned.
- Add a durable Python worker and queue for ingestion/generation jobs; Celery and Redis are a candidate when implementing that phase. FastAPI BackgroundTasks are suitable for small post-response tasks, not the sole durability mechanism for heavy document jobs.
- pytest and FastAPI test client for API, authorization, parsing, and grading checks.

Do not introduce a second application database initially. A later self-managed retrieval implementation could use PostgreSQL/pgvector, but that is a separate decision, not required for the first Python backend.

## Core feature logic

### Identity and notebooks

React signs in using Firebase Authentication and sends the ID token as a Bearer token. Python verifies it and derives the user ID from the token. Never accept a request body user_id as authority. Every notebook, source, conversation, note, graph, deck, quiz and attempt must be checked against that identity.

Firebase Admin/server access bypasses Firestore client security rules, so Python must enforce ownership itself. Keep deny-by-default client database rules once the frontend no longer accesses business data directly; retain explicit migration access only while needed.

Notebook deletion first marks it unavailable, then a retryable cleanup job removes original files, extracted data, retrieval-index references, and dependent records. Do not leave deleted documents searchable by the AI provider.

### Source ingestion

1. Verify identity and notebook ownership.
2. Enforce the 10 MB limit while receiving the upload; validate actual format as well as extension, reject unsupported/encrypted/corrupt files with useful errors, and limit DOCX decompression resources.
3. Save the original under a server-generated storage key. Store the display filename separately and calculate a checksum for duplicate detection within the notebook.
4. Create the source record and a processing job; return source_id and job_id promptly.
5. Extract PDF text with page boundaries, DOCX paragraphs/tables, or decoded TXT. Save extracted text outside large Firestore documents.
6. If extraction finds no readable text, mark needs_ocr or failed with a reason; never report the file as ready.
7. Add the source to the notebook's retrieval index and wait for indexing completion before marking ready.
8. Expose queued, extracting, indexing, ready, needs_ocr and failed states. A retry must not create duplicate sources or index entries.

Upload progress and processing progress are separate UI states. Keep retries and source deletion idempotent. Renaming updates the displayed citation filename without breaking the source ID mapping.

### Chat, summaries, explanations and study guides

React submits notebook_id, conversation_id, question and optional selected source IDs, rather than supplying trusted document text. Python checks ownership and source readiness, retrieves relevant material, includes a bounded conversation history, then calls the AI provider. Treat uploaded document instructions as reference data, never system instructions.

Map returned file citations to authorized source IDs. Save both the message and citation metadata. When retrieved evidence is insufficient, say so. Stream text when practical and persist final status, including interrupted or failed replies. Summarization should cover selected documents rather than relying on a single narrow question retrieval; longer documents may need section summaries followed by synthesis.

### Notes

Save title, Tiptap JSON, extracted plain text, revision and timestamps. Debounce autosaves in React, validate content and size in Python, and reject stale revisions with a conflict response. Sanitize exported/rendered HTML. Real-time collaboration is outside the initial scope.

### Flashcards

Retrieve selected study material, request a structured list of focused question/answer pairs with source references, validate the result, remove duplicates, and save an editable deck. Structured output validates shape, not truth: references and content still need checks and user review.

Keep review records separate from card content. First ship saved decks and manual practice. Add ratings and a tested FSRS scheduling library in a later phase rather than inventing a memory algorithm. A review event updates the next due date; it does not call the AI model again.

### Quizzes

Generate questions, plausible distractors, a correct option, explanation and source references. Validate unique options and exactly one correct option. Persist an immutable question version for each attempt, including stable option IDs if the display order is shuffled.

Return questions and choices without answer keys during an attempt. Python scores submitted option IDs, saves responses and the score, then returns explanations according to feedback mode. Retried submissions must not double-count. Generation uses AI; ordinary multiple-choice grading does not.

### Mind maps

Persist graph nodes, edges, labels, coordinates and viewport. The existing filename map remains a source-navigation view. An AI concept map is a separate operation that produces concepts and labeled relationships grounded in selected sources. Validate node IDs, valid edge endpoints, size limits and source references. Users can revise both generated text and layout.

### Focus timer and tasks

React displays remaining time from a saved deadline, rather than assuming every interval tick ran. Python stores session type, duration, started_at, paused_at, remaining_seconds and completion status. Pause/resume updates the stored session; refresh reconstructs it. Store timestamps in UTC and display in the user's timezone. Tasks have their own completion state. No AI call or per-second server request is necessary.

## Data groups

Use user-scoped Firestore collections for notebooks, sources, ingestion_jobs, conversations, messages, notes, decks, cards, card_reviews, quizzes, quiz_question_versions, quiz_attempts, attempt_answers, mind_maps, focus_sessions, tasks and preferences. Store originals and large extracted text in private object storage. Retain source/index-version references on generated artifacts so outdated content can be identified after a source changes.

## Proposed API surface

All routes below live under /api/v1 and require an authenticated owner unless explicitly public.

| Area | Routes |
|---|---|
| Health/identity | GET /health; GET /me |
| Notebooks | GET/POST /notebooks; GET/PATCH/DELETE /notebooks/{id} |
| Sources | GET/POST /notebooks/{id}/sources; GET/PATCH/DELETE /sources/{id}; GET /sources/{id}/preview |
| Processing | GET /jobs/{id}; POST /sources/{id}/retry |
| Assistant | GET/POST /notebooks/{id}/conversations; GET/POST /conversations/{id}/messages |
| Notes | GET/POST /notebooks/{id}/notes; GET/PATCH/DELETE /notes/{id} |
| Generation | POST /notebooks/{id}/generations with kind, source_ids and settings; returns job ID |
| Cards | GET /decks/{id}/cards; PATCH /cards/{id}; POST /cards/{id}/reviews |
| Quiz practice | POST /quizzes/{id}/attempts; GET /attempts/{id}; POST /attempts/{id}/submit |
| Mind maps | GET/POST /notebooks/{id}/mind-maps; GET/PATCH/DELETE /mind-maps/{id} |
| Focus/tasks | POST /focus-sessions; PATCH /focus-sessions/{id}; GET/POST /tasks; PATCH/DELETE /tasks/{id} |
| Search/transfer | GET /search; POST /workspace/import; GET /workspace/export |

Use consistent JSON errors, bounded page sizes, request IDs and generation/upload idempotency keys. Add API rate limits, AI concurrency/token budgets, provider timeouts and bounded retries. Never log file contents, tokens or secrets by default.

## Build order and acceptance gates

1. Python foundation: config, health endpoint, auth verification, ownership checks, notebook CRUD. Two test users cannot read or edit each other's records. Fresh accounts are empty.
2. Sources: private original uploads, validation, extraction jobs, preview, retry, rename and deletion. Include normal PDF, scanned PDF, DOCX tables, TXT encoding, corrupt/oversized files and restart recovery checks.
3. Persistent notes and local-data import: preserve user-created notebooks, make import repeatable, test revision conflicts. Do not silently upload the entire local workspace at sign-in.
4. Retrieval and chat: source selection, citations, saved conversations and streaming. Check notebook isolation, unsupported questions, deleted sources and provider failures.
5. Generated decks/quizzes: schema validation, editable content, source attribution, server grading, repeat-submission behavior. Use a small fixed source set to evaluate quality before enabling broad generation.
6. Map persistence and focus sessions/tasks: refresh/restore checks, pause/resume and graph validation. Add spaced repetition after saved-card practice works reliably.
7. Replace frontend direct cloud writes and the old Express route, update startup commands/proxy, then remove Node backend dependencies. React/Vite still uses Node tooling for frontend development/builds.

## Official references

- [FastAPI uploads](https://fastapi.tiangolo.com/tutorial/request-files/)
- [FastAPI background jobs guidance](https://fastapi.tiangolo.com/tutorial/background-tasks/)
- [Firebase token verification, including Python](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firestore server access and security rules](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [pypdf extraction and OCR limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html)
- [python-docx](https://python-docx.readthedocs.io/en/latest/)
- [OpenAI hosted file search](https://developers.openai.com/api/docs/guides/tools-file-search)
- [OpenAI structured outputs and Pydantic](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Tiptap persistence](https://tiptap.dev/docs/editor/core-concepts/persistence)
- [React Flow save and restore](https://reactflow.dev/examples/interaction/save-and-restore)
- [Anki scheduling algorithms](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm)

These sources establish available mechanisms. The service boundaries, API design, database groups and build order above are recommendations for this repository, not requirements imposed by the documentation.
