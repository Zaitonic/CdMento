# Project structure

Run `npm run dev:all` from the project root. The React dev server remains at `http://127.0.0.1:5173`, and the Python API remains at `http://127.0.0.1:8000`.

## Root folders

| Folder | Contents |
| --- | --- |
| `frontend/` | React source, public assets, entry HTML, and frontend tool configuration. |
| `backend/` | Python source, provider adapters, tests, and private runtime data. |
| `firebase/` | Firestore/Storage security rules; their deny-client-access behavior is unchanged. |
| `scripts/` | Cross-platform Python/API launch helpers. |
| `docs/` | Active setup guides and this file. Older design plans live in `plans/`; historical implementation notes in `history/`; sample material in `examples/`. |
| `artifacts/` | Existing screenshots and previews, retained at their shared paths. |
| `build/web/` | Generated production frontend output. |
| `.cache/` | Generated tool caches. Unused empty folders were retained under `empty-folders/` rather than deleted. |
| `.venv/`, `node_modules/` | Installed dependencies. These remain at their existing paths. |

`package.json`, `package-lock.json`, `.env`, `.env.example`, `.gitignore`, `pyproject.toml`, and `README.md` stay at the root. Vite loads the root `.env` while serving the frontend directory. Private variables are not exposed to React; only explicitly `VITE_`-prefixed configuration is public. Python continues to load the same `.env` and `backend/data/`.

## Frontend features

The frontend is organized by feature under `frontend/src/features/`:

- `home/` — dashboard, real workspace totals, study shortcuts.
- `notebooks/` — reusable notebook library, grid/list views.
- `sources/` — source library, PDF reader, extracted text, paste-text form, reviewer preparation.
- `notes/` — Tiptap editor, note shelf, document outline.
- `flashcards/` — draft acceptance, practice, scheduled review.
- `quizzes/` — practice/exam sessions, question navigation, results.
- `mindmaps/` — React Flow canvas, minimap, saved nodes/edges.
- `focus/` — persistent timer and task checklist.
- `assistant/` — source-grounded conversation and reference layout.
- `study/` — shared artifact loading, source evidence, and study headings.
- `workspace.css` — feature-specific layouts, theme tokens, responsive rules.

`frontend/src/App.tsx` owns the signed-in shell: navigation, account menu, notebook dialogs, global upload shortcut, and routes. `frontend/src/Root.tsx` owns public/protected routing. `frontend/src/Session.tsx`, `frontend/src/store.ts`, and `frontend/src/api.ts` keep authentication, workspace state, and API transport shared rather than duplicating them per tool. The old StudyPages/LearningTools/FocusPage paths are small compatibility re-exports.

`backend/` contains Python API routes (`main.py`), validated requests (`schemas.py`), persistence (`repository.py`), private originals (`storage.py`), document extraction (`documents.py`), background jobs (`services.py`), authentication, and tests. Runtime SQLite/uploads remain in ignored `backend/data/`; they are not source files.

Sources use the existing upload/ingestion pipeline for PDF, DOCX, TXT, and pasted text (saved as a TXT source). Original files are served only through an owner-scoped, authenticated endpoint. PDF page labels and unreadable-page warnings come from local extraction. `backend/ocr.py` renders and recognizes scanned pages locally with bundled RapidOCR models. PDF originals use chunked streaming so the development proxy transfers complete files.

`frontend/src/features/ai/` owns the reusable provider-status display. `backend/providers/gateway.py` implements server-side automatic provider routing, free-model restrictions, persisted quotas/cooldowns and safe error handling. `backend/ai.py` owns local retrieval, validated source quotes, and reviewer assembly. Background jobs retain reviewer checkpoints and queued conversations. See [AI setup](AI_SETUP.md) for key configuration, privacy, quota boundaries and remaining live verification.
