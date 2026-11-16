# CdMento — Your Space to Understand

> A modern, AI-powered study workspace designed for students, researchers, and lifelong learners to organize materials, master difficult concepts, and study smarter.

---

## 💡 What is CdMento?

**CdMento** is an intelligent web-based study platform and Progressive Web App (PWA). It brings together documents, lecture notes, visual mind maps, spaced repetition flashcards, quizzes, and an AI study assistant into a unified, distraction-free environment. 

Instead of juggling separate apps for notes, flashcards, PDF reading, and timers, CdMento connects your entire learning workflow to your source materials.

---

## ✨ Core Features

### 📚 Document Hub & Smart Ingestion
- Upload and organize course documents in **PDF**, **DOCX**, and **TXT** formats.
- **Offline OCR Engine**: Scanned or image-only PDF pages are automatically transcribed locally using bundled neural models without exposing data to third parties.
- Split-pane reading with side-by-side extracted text, page references, and section navigation.

### 📝 Rich-Text Study Notes
- Distraction-free, responsive block-based editor.
- Auto-saving, revision tracking, and real-time formatting.
- Notebook-level organization with color-coded categories and fast search.

### 🤖 Source-Grounded AI Study Assistant
- Ask questions grounded directly in your uploaded textbooks and lecture slides.
- Every answer includes verifiable source citations and page numbers.
- Automated creation of study guides, summaries, and key concept breakdowns.

### 🗂️ Spaced Repetition Flashcards (FSRS)
- Practice flashcards powered by the state-of-the-art **FSRS (Free Spaced Repetition Scheduler)** algorithm.
- AI card generator: Automatically extracts high-yield flashcard decks from any document section.
- Practice mode and due-date scheduling optimized for long-term memory retention.

### 🎯 Interactive Quizzes & Assessments
- Generate self-assessment quizzes in **Practice Mode** (instant explanations) or **Exam Mode** (timed assessment).
- Server-side grading with targeted weak-concept diagnostic feedback.

### 🧠 Concept Mind Maps
- Visualize relationships between topics with interactive node graphs.
- Add custom concepts or generate AI-assisted knowledge branches to structure complex topics.

### ⏱️ Focus Timer & Task Tracking
- Interval timer (Pomodoro technique) with custom work and rest periods.
- Session time tracking calculated against deadlines.
- In-session task checklist to maintain concentration.

### 📱 Progressive Web App (PWA) & Mobile Ready
- Installable on iOS, iPadOS, Android, macOS, and Windows.
- Offline support with background asset precaching via Service Workers.
- Mobile-first ergonomic touch interface compliant with WCAG AA accessibility standards.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| --- | --- |
| **Frontend** | React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Zustand · React Router 7 · TipTap (ProseMirror) · @xyflow/react (React Flow) · PDF.js (`pdfjs-dist`) · Motion · Lucide React |
| **Backend** | Python 3.13 · FastAPI (async REST) · Pydantic v2 · SQLite · Firestore (hosted) · RapidOCR (ONNX Runtime, OpenCV, PyPDFium2) · PyFSRS · Celery + Redis |
| **AI & Search** | Cloudflare Workers AI (`llama-3.3-70b-instruct`) · Groq (`gpt-oss-120b`) · OpenRouter free tier · multi-provider failover gateway with JSON-schema enforcement |
| **Scholarly Sources** | Crossref · OpenAlex · Europe PMC · PubMed · arXiv · Semantic Scholar (optional API key) · Google Scholar link-out |
| **PWA & Accessibility** | Web App Manifest · Service Worker precaching · WCAG AA contrast · 44px touch targets |
| **Testing & Tooling** | Vitest + Testing Library · pytest · Prettier · TypeScript (`tsc --noEmit`) · GitHub · Vercel (optional hosting) |

---

## 🔒 Privacy & Data Architecture

- **Private by Design**: Source files, notes, and personal study data remain scoped to your account.
- **Source Grounding**: AI features operate strictly on the excerpts of documents you select.
- **Offline OCR**: Optical Character Recognition runs entirely on the local CPU; document images are never sent across the network for text extraction.
- **WCAG Accessible**: High-contrast typography, screen-reader landmarks, and minimum 44px touch targets.

---

## 🚀 Run locally

From the repository root, install the frontend and Python dependencies, then create your local environment file:

```powershell
npm ci
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
Copy-Item .env.example .env
npm run dev:all
```

The template configures the shared CdMento Google OAuth client for local sign-in. Each teammate must be added as a test user in the Google Cloud project's **Google Auth Platform → Audience** while the app is in testing mode. Email/password signup and password reset use Brevo transactional email; configure `BREVO_API_KEY` and a verified `BREVO_SENDER_EMAIL` in `.env`. Keep `.env` and AI provider keys private and never commit them. Each developer should supply their own AI provider keys in `.env` if they need AI features. For project layout and API details, see [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) and [docs/GOOGLE_AUTH.md](docs/GOOGLE_AUTH.md).
