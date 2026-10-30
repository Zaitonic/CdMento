# Python backend implementation

The React app now calls FastAPI at `/api/v1`. Express has been removed.

## Delivered

- Owner-scoped persistence with SQLite for local development and a Firebase Admin/Firestore/Cloud Storage adapter for configured cloud environments.
- Firebase ID-token verification and deny-client-access rules for backend-owned records.
- Notebook CRUD, note autosave/revision conflicts, explicit repeatable local import, and recovery copies for unsaved notes.
- Private original uploads, PDF/DOCX/TXT extraction, duplicate checks, queued job statuses, OCR-needed detection, retries and notebook cleanup.
- Server-owned selected-source retrieval, persisted chat, source citations and structured AI generation through the OpenAI Python SDK.
- Editable card drafts, acceptance/discard actions, quick practice, FSRS due dates and idempotent review events.
- Practice/exam quiz modes, snapshotted attempts, server-side scoring, explanations and weak-concept feedback.
- Saved editable concept maps and deadline-based focus sessions/tasks.
- Default persisted local job polling and optional Redis/Celery worker/beat integration.

## Verified

- 17 backend tests pass with temporary databases and deterministic AI test doubles.
- TypeScript check and Vite production build pass.
- Frontend production dependency audit reports zero vulnerabilities; Python package dependency checks pass.
- Browser verification: explicit legacy import, note save/refresh, missing-key generation message, paused timer restore, and saved map restore.

## External verification still required

- Real Firebase project credentials, deployed IAM/security rules and cloud storage/database operations.
- Real OpenAI API key, hosted indexing/retrieval and generated-content quality evaluation.
- A live Redis/Celery environment for external-worker verification.

Local mode is one developer workspace on loopback, not a public multi-user authentication substitute. Full deployment hardening, shared limits, high-concurrency races and backups remain operational work. Chat streaming, source highlights, short-answer grading, hint ladders, audio/video and multiplayer remain outside this implementation. See the README for exact behavior and limits.
