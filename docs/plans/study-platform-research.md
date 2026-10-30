# CdMento study-feature research

Research date: 25 October 2026. Planning only; no application/backend changes.

## Research scope

Reviewed public official help pages and product documentation for NotebookLM, Gizmo, RemNote, Quizlet, and Anki. This is a comparison of documented behavior, not logged-in hands-on testing or access to private source code, ranking systems, prompts, or algorithms. Quizlet's marketing Learn page returned HTTP 403; its official Learn help article was accessible and used instead.

CdMento should implement these learning patterns independently using its own branding, interface, data model, and Python backend. Proposed improvements below are goals for this project, not claims that competitors lack them or that learning outcomes are already proven.

## Observed patterns

| Platform | Documented pattern | Useful application in CdMento |
|---|---|---|
| NotebookLM | Select sources for chat; inspect citations and return to the relevant source passage; customize source-based quizzes/cards by topic, difficulty and quantity | One source-selection state shared by chat and generation, clickable evidence, and configurable study material |
| Gizmo | Import learning content into cards; test key information in Memorise; use spaced repetition and a tutor for deeper explanations | Separate retrieval practice from guided explanation; use review performance to choose subsequent work |
| RemNote | Read/highlight documents and connect passages to notes/cards; preview generated cards and choose which to keep; reuse generation for identical text/settings | Let students generate from a specific passage, review a draft, and preserve links back to evidence |
| Quizlet | Learn provides a personalized study experience and configurable question types | Distinguish assisted practice from an independent assessment; adjust practice to observed performance |
| Anki | FSRS schedules reviews using review history; rating semantics distinguish forgetting from difficult successful recall | Use a maintained scheduler for review timing and record meaningful ratings, rather than a homegrown fixed-interval rule |

## Proposed central study cycle

Create notebook -> upload/select sources -> inspect and understand -> draft study material -> user reviews it -> practice -> inspect errors -> explain weak concepts -> schedule another review.

Every artifact should retain notebook_id, source IDs, source revision, concept references, and generation version where applicable. User edits must survive source refreshes; mark material outdated and offer regeneration rather than silently replacing it.

## Feature logic proposals

### 1. Sources and citations

Keep current PDF/DOCX/TXT scope initially. Validate uploads, preserve originals, extract readable text with locations, and index only successful sources. Expose upload and processing status separately. User source selection controls chat and generation; never silently use unchecked sources.

Answers should link to the underlying evidence. Show page/section locations only when the extraction/retrieval system actually supplies them. A hosted file-search implementation that returns file-level citations cannot be presented as exact page-level grounding without extra location mapping.

If no selected source supports an answer, state that the notebook does not contain sufficient information. A source citation is evidence to inspect, not proof that every sentence in the answer is correct.

### 2. AI assistant

Offer user-selectable actions such as Explain, Give an example, Compare, and Quiz me. In a guided learning session, the tutor can start with a question, give a small hint if requested, then reveal a fuller explanation. Direct-answer mode remains available; users should not have to endure tutoring when they want a concise reference answer.

Save a useful explanation into notes with its citations. Record tutor support as assistance, not as an unaided correct quiz response. Keep private instructions separate from source material and do not execute document-embedded commands.

### 3. Flashcards

Replace the current first-two-words sentence rule with question/answer, cloze, definition, and later application cards. Aim for one testable idea per card. Each generated card has a source reference and enters a draft queue, where users can edit, accept, or discard it.

Deduplicate by concept and question, not just exact text. Identical source revision plus generation settings can reuse a cached draft. Accepted cards keep stable IDs even after wording changes; significant conceptual edits may require a review-history reset chosen by the user.

Separate two modes:

- Quick practice: user-selected topics/cards, without pretending to be a scheduling decision.
- Scheduled review: due cards selected by a maintained FSRS implementation. Store review time, rating, elapsed time, prior schedule and resulting schedule. Record forgotten answers as Again, not Hard. Use defaults until enough history exists for personalization.

### 4. Quizzes

Offer Practice and Exam modes. Practice can provide hints and immediate explanations; Exam withholds hints and answer keys until submission. Generate questions from selected sources with explicit topic, difficulty and count settings. Include explanations for the correct answer and for meaningful distractors.

Start with multiple choice. Add short-answer practice later using explicit rubrics and acceptable alternatives. Deterministic grading handles objective answers; AI-assisted short-answer feedback should acknowledge uncertainty and allow user review instead of presenting every semantic judgment as certain.

Keep the answer key on Python, snapshot question versions per attempt, and score stable option IDs. A retry endpoint must not double-count a submission. Generate follow-up questions that test the missed concept in a different example, instead of repeating the identical wording immediately and calling that mastery.

### 5. Progress and next steps

Track evidence by concept: unaided correct, incorrect, assisted, review timing, and number of observations. Do not label a topic mastered after one correct multiple-choice response or because the user opened a page. Mastery is an estimate; show insufficient evidence when history is sparse.

At session end, give a short actionable summary: which concepts need work, links to relevant passages, and a suggested next practice session. Do not add a large analytics dashboard to the minimalist home screen.

### 6. Notes

Allow selected source passages and accepted explanations to become notes with backlinks. From a user-selected note section, offer Create cards or Create quiz. Mark whether a passage was user-written, quoted, or AI-generated where relevant; users remain in control of their own writing.

Persist editor JSON and revisions. Keep highlights anchored by source revision and location rather than storing only a visual color.

### 7. Mind maps

Keep a distinction between the current source-navigation map and a future concept map. The concept map contains topics and labeled relationships, with source references on nodes/edges where available. Clicking a concept can open its explanation, related notes, and a targeted practice action.

Users can rename concepts, remove unsupported links, move nodes, and save the layout. Do not infer that a relationship is established just because two concepts occur in the same document.

### 8. Focus sessions

Connect the existing timer to a chosen notebook and a small user-selected task, such as reviewing due cards or practicing one topic. Save session state so refresh does not reset progress. End with a brief completion check and an optional next step.

Keep the focus timer simple; do not invent rewards based only on elapsed timer time. It is possible to leave a timer running without studying.

## One example

A student uploads a computer-networks chapter and selects the LAN/WAN section. They ask for an explanation, inspect the linked evidence, and accept a few generated cards. A practice quiz reveals repeated confusion about geographic scope. CdMento offers a contrasting example and a new application question, then adds the accepted cards to scheduled review. The concept map links LAN and WAN to their definitions, examples, and supporting source passages. This is a proposed flow, not a claim about an existing competitor's exact implementation.

## Python responsibilities

- Authorized source retrieval and citation mapping.
- Jobs for extraction and AI generation, including retries and cancellation.
- Structured generation validation, duplicate detection, caching and source revisions.
- Deck/card persistence and review scheduling.
- Quiz attempt snapshots, answer protection, grading and feedback.
- Concept associations and conservative progress estimates.
- Saved note/map/focus-session state.

UI interactions such as card flipping, expanding a map, and displaying timer ticks stay in React. Ordinary scoring, scheduling and persistence should not call an AI model for every interaction.

## Priorities after approval

1. Foundation already described in backend-plan.md: Python authentication, notebook ownership, storage and source processing.
2. Shared source selection, reliable citations, persistent notes and conversations.
3. Draft/review workflow for generated cards and quizzes; server-side scoring.
4. Saved decks and FSRS review history; targeted follow-up practice.
5. Source-linked concept maps and connected focus sessions.

Keep audio/video summaries, multiplayer games, public deck marketplaces, leagues and complex gamification out of the first implementation. They expand scope without fixing the current core gaps.

## Acceptance examples

- An unchecked source cannot influence a notebook-only generation request.
- Every displayed citation resolves to an authorized source; fabricated citation IDs are rejected.
- Generated cards can be edited/rejected before joining scheduled practice.
- The same cached generation request does not create duplicate accepted cards.
- Hinted success is distinguishable from unaided recall.
- Quiz answers are absent from in-progress attempt payloads.
- A concept can remain uncertain even after a small number of successful responses.
- Source updates mark affected material for review without overwriting user edits.
- Due dates, notes, map layouts and paused focus sessions survive reloads.
- Fresh accounts contain only user-created content.

## Official sources reviewed

- [NotebookLM customizable flashcards, quizzes and source selection](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-app-quizzes-flashcards/)
- [Google notebook chat and citations](https://support.google.com/gemininotebook/answer/16179559?hl=en)
- [Google notebook mind maps](https://support.google.com/gemininotebook/answer/16212283?hl=en)
- [Gizmo overview](https://help.gizmo.ai/en/articles/14472668-how-does-gizmo-work)
- [Gizmo spaced repetition](https://help.gizmo.ai/en/articles/15647638-what-is-spaced-repetition)
- [Gizmo practice tests](https://help.gizmo.ai/en/articles/16310903-what-is-a-practice-test)
- [RemNote reader and source highlights](https://help.remnote.com/en/articles/6690975-learning-from-pdfs-and-files-with-the-remnote-reader)
- [RemNote AI flashcard preview and reuse](https://help.remnote.com/en/articles/10102901-generating-flashcards-with-ai)
- [Quizlet Learn](https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn)
- [Anki review scheduling and FSRS](https://docs.ankiweb.net/manual/deck-options)
