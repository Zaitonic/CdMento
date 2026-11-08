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

### Frontend
- **Framework & Language**: React 19, TypeScript
- **Build & Dev Tooling**: Vite
- **Styling**: Tailwind CSS, Custom Modern Responsive CSS Design System
- **State Management**: Zustand
- **Routing**: React Router (v7)
- **Rich-Text Editing**: TipTap (ProseMirror)
- **Mind Mapping / Graphs**: @xyflow/react (React Flow)
- **Animations & Icons**: Motion, Lucide React
- **Document Rendering**: PDF.js (`pdfjs-dist`)
- **PWA Architecture**: Web App Manifest, Service Worker API, Cache Storage API

### Backend & API
- **Language & Runtime**: Python 3.13
- **Framework**: FastAPI (Asynchronous REST API)
- **Data Validation & Schemas**: Pydantic v2
- **Data Persistence**: SQLite (Local Database), Repository Architecture
- **OCR Engine**: RapidOCR (ONNX Runtime, OpenCV, PyPDFium2)
- **Spaced Repetition Engine**: PyFSRS
- **Task Queue**: Celery & Redis support for durable background job processing

### AI & Machine Learning Infrastructure
- **Model Gateway**: Multi-provider failover routing with strict JSON-schema enforcement
- **Primary AI Provider**: Cloudflare Workers AI (`llama-3.3-70b-instruct`)
- **Supported Fallbacks**: Groq (`gpt-oss-120b`), OpenRouter Free Tier
- **Safety & Verification**: Server-side output validation, citation checking, and token budgeting

---

## 🔒 Privacy & Data Architecture

- **Private by Design**: Source files, notes, and personal study data remain scoped to your account.
- **Source Grounding**: AI features operate strictly on the excerpts of documents you select.
- **Offline OCR**: Optical Character Recognition runs entirely on the local CPU; document images are never sent across the network for text extraction.
- **WCAG Accessible**: High-contrast typography, screen-reader landmarks, and minimum 44px touch targets.
