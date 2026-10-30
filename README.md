# CdMento

A React study workspace with a **Python/FastAPI backend**. The Express backend has been replaced. New workspaces start empty.

## Project folders

```text
final/
├── frontend/          React app, public assets, HTML entry, Vite/Vitest/TypeScript config
│   ├── src/           Components, study features, state, styles, and frontend tests
│   └── public/brand/  CdMento logo assets
├── backend/           Python API, providers, extraction, persistence, and backend tests
│   └── data/          Private account database and uploads (ignored)
├── firebase/          Firestore and Storage security rules
├── scripts/           Local server and Python launch helpers
├── docs/              Current setup guides, examples, plans, history, and licenses
├── artifacts/         Screenshots and previews; existing shared paths are preserved
├── build/web/         Generated production website (ignored)
├── .cache/            Vite, Vitest, pytest, and Ruff caches (ignored)
├── .venv/             Local Python dependencies (ignored)
├── node_modules/      Local JavaScript dependencies (ignored)
├── .env               Private server settings and keys (ignored)
├── .env.example       Safe configuration template
├── package.json       Run commands from this root folder
└── pyproject.toml     Python test and formatter configuration
```

The Python virtual environment and JavaScript dependencies stay at the root so existing installations remain usable. App source lives in `frontend/` and `backend/`; generated files are grouped separately. Private account data and `.env` keep their existing locations.

## Start locally (Windows PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock.txt
npm install
npm run dev:all
```

The environment for this workspace has already been installed. Start with `npm run dev:all` on subsequent runs.

The root page is the public CdMento landing page. Login, signup, password reset, and email verification have their own pages. The signed-in home is `/workspace`; existing study URLs such as `/notes` remain available after login. Public pages work without cloud credentials, but account creation and the browser workspace require Firebase configuration; local API mode does not bypass login.

- App: http://127.0.0.1:5173/
- Python API: http://127.0.0.1:8000/api/v1/health
- Interactive API documentation: http://127.0.0.1:8000/docs

On macOS/Linux, install requirements with `.venv/bin/python -m pip install -r backend/requirements.txt`. The Node startup helper selects the appropriate virtual environment executable. Node/Vite remains frontend tooling; all backend business logic is Python.

`npm run dev` starts the frontend alone. `npm run server` starts FastAPI. `npm run build` checks TypeScript and builds the frontend. `npm run preview` previews `build/web/`. `npm test` runs frontend tests; `npm run test:backend` runs Python tests on Windows, macOS, or Linux. The launch commands still run from the project root.

## Local and cloud modes

The default `AUTH_MODE=local`, `DATA_BACKEND=sqlite` runs one local developer workspace with no cloud credentials. SQLite records and private original uploads are stored under `backend/data/`, excluded from source control. Local mode binds to loopback, validates host/origin headers, and is **not a public multi-user deployment mode**. Local data belongs to this computer, not to a Firebase account.

Cloud mode is implemented through Firebase Admin Python. Copy `.env.example` to `.env` and configure:

```dotenv
AUTH_MODE=firebase
DATA_BACKEND=firestore
FIREBASE_PROJECT_ID=your-project
FIREBASE_STORAGE_BUCKET=your-bucket
GOOGLE_APPLICATION_CREDENTIALS=C:/private/path/service-account.json
VITE_FIREBASE_API_KEY=your-public-web-config
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=your-public-app-id
```

Enable Firebase Email/Password authentication, Firestore, and Storage. Authorize the app domain for Firebase Authentication. Credentials remain outside the repository. The VITE_FIREBASE identifiers are public frontend configuration; the service account and AI key are backend secrets.

React sends a Firebase ID token; Python verifies it, including revocation, and derives the owner ID. Every record read/update is owner-scoped. Deploy the deny-client-access rules in `firebase/firestore.rules` and `firebase/storage.rules` after migrating any old direct-client data; the Admin SDK uses server credentials/IAM. The frontend no longer writes application records directly to Firestore or Storage. Firebase mode cannot be verified live until a project and credentials are supplied.

Accounts must verify their email before opening workspace APIs. The backend saves profile information from verified token claims at `users/{uid}/profile/account` in Firestore; passwords are managed by Firebase Authentication and are never stored in these documents. Sign-out flushes pending changes and clears the in-memory workspace.

Add `localhost` and `127.0.0.1` to Firebase Authentication's authorized domains for development. Email links can use Firebase's default hosted action page and return to this app. To use the included custom verification/reset page, configure the email templates' action URL as `http://localhost:5173/auth/action` locally, or your HTTPS app URL followed by `/auth/action` when deployed. Restart both servers after changing `.env`.

The landing page uses original React/CSS components inspired by Kokonut UI patterns and the existing Motion package. No paid components were added. Its interactive examples never create account data. Mobile app badges are explicitly “Coming soon”; Bklit charts are deferred until real study analytics are available. Provider adapters are available; live AI requires your own server-side keys. Provider selection and quota failover are automatic.

## Existing local work

### Local demo account

With `AUTH_MODE=local` and `DATA_BACKEND=sqlite`, run `.venv/Scripts/python -m backend.create_demo_account` once to create `demo@cdmento.local`. The command prints a generated password once; only its salted scrypt hash is saved. It does not replace an existing demo account. The normal login page accepts this account when the backend reports it available. Its notebooks belong to the separate `demo-student` workspace, and sessions expire after 12 hours or on logout. This is a local test account; Firebase mode disables the demo endpoints. Demo accounts use the same server configuration and automatic AI routing.

On the first backend connection, previous browser-only notebooks are preserved in a separate local backup and an **Import my notebooks** banner appears. Import is explicit, repeatable, and merges records without overwriting an existing server record with the same ID. It never silently sends a local workspace to a signed-in cloud account.

The JSON export currently contains notebooks, extracted sources, and notes. It is not a backup of original binaries or all generated study/review/session records. Back up the SQLite database and uploads together for a full local backup. Do not delete browser storage before confirming the import.

## Features now connected to Python

- Notebook creation, rename, deletion, and persistence. Deletion hides the notebook and runs a retryable cleanup job for files and dependent study records.
- PDF, DOCX, and TXT uploads with a 10 MB limit, original-file retention, duplicate detection, asynchronous extraction, status, failure details, and retry.
- PDF extraction retains page numbers; DOCX extraction includes paragraphs and tables. Scanned/image-only pages use free offline RapidOCR with bundled models; page references and OCR provenance are retained.
- Rich-text notes save Tiptap JSON/HTML, use debounced saves, and reject stale revisions. A failed save is shown in the interface.
- Shared source selection for chat and AI generation.
- Persisted source-grounded conversations with clickable file citations and a Save to notes action.
- AI-generated card drafts: edit, accept, or discard before practice. Accepted cards support quick practice and FSRS due-date scheduling with stored review events.
- AI-generated quizzes with Practice/Exam modes, server-held answer keys, server-side grading, explanations, and weak-concept feedback. Attempts snapshot question versions; repeat submissions return the stored result.
- Editable mind maps with saved nodes, edges, labels, viewport, and revisions. Optional AI concept generation is a separate action.
- Persisted focus sessions, pause/resume/deadlines, and tasks. Remaining time is computed from the deadline, not from accumulated browser ticks.

## AI connection

The Python gateway supports Groq, optional OpenRouter free models, Cloudflare Workers AI, and a local FreeLLMAPI/Mistral prototype. Configure your own server-side keys and confirm unbilled/free-plan accounts using [AI Setup](docs/AI_SETUP.md). Provider selection and quota failover are automatic. Reviewer generation, cards, quizzes, maps, and saved conversations use local source retrieval; no document upload triggers an AI call.

Reviewers process selected coverage in bounded parts with checked source quotes/page references and durable quota-retry checkpoints. Conversations preserve recent messages and a bounded local summary across providers. Unsupported citations and incomplete JSON are rejected. AI can still make interpretation errors, so students should compare generated material with originals. Live AI has not been verified without user-supplied keys.

## Background jobs

Local mode runs a polling worker inside FastAPI, backed by persisted job records. Queued jobs survive restarts. An interrupted processing job is eligible for recovery after its ten-minute lease expires. Keep one local API process for the development workflow.

For an external worker, set `REDIS_URL` and run both:

```powershell
.\.venv\Scripts\python.exe -m celery -A backend.tasks worker --pool=solo
.\.venv\Scripts\python.exe -m celery -A backend.tasks beat
```

The internal worker is disabled when REDIS_URL is set. Celery beat re-enqueues queued, due waiting, and expired jobs. Redis/Celery mode is optional and has not been exercised against a live Redis service here. Failed jobs can be retried using `POST /api/v1/jobs/{id}/retry`.

## Validation

```powershell
npm test
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm run build
```

Tests cover empty accounts, persistence, ownership isolation, stale-note conflicts, uploads and original retention, duplicate/corrupt/oversized files, OCR detection, DOCX tables, source selection, saved chat, missing AI configuration, generation caching, card acceptance/FSRS review idempotence, answer-key protection, grading, map revisions, focus/task persistence, deletion cleanup, repeatable imports, token checks and local-origin restrictions.

The cloud and provider integrations need end-to-end verification with real credentials before public deployment. Public deployment also needs HTTPS, configured origins/hosts, shared rather than per-process request limits, cloud concurrency/load testing, operational backups, and appropriate service-account IAM.

## Feature layout organization

Workspace pages now live in `frontend/src/features/`, with a separate module and layout for each study tool. See [project structure](docs/PROJECT_STRUCTURE.md). Sources accepts PDFs or pasted text and displays originals alongside extracted text and reviewer preparation controls. Reviewer/chat/study-material generation is available after provider setup; provider selection and quota failover are automatic. Existing saved study material can still be practiced. Scanned pages are read with local OCR; any remaining unreadable pages are flagged rather than silently treated as complete.

Local PDF OCR is enabled by default. `OCR_ENABLED=false` disables recognition, and `OCR_MAX_PAGES=100` bounds automatic OCR per upload. Use **Read scanned pages** to reprocess an existing original. Recognition stays on this computer and does not need an AI key. AI reviewer generation still needs the configured provider keys.
