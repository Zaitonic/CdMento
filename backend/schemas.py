from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DemoLogin(Input):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class GoogleLogin(Input):
    credential: str = Field(min_length=100, max_length=12000)
    remember: bool = False


class PasswordSignup(Input):
    email: str = Field(min_length=6, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().casefold()
        if "@" not in value or "." not in value.rsplit("@", 1)[-1] or any(c.isspace() for c in value):
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("display_name")
    @classmethod
    def trim_display_name(cls, value):
        if not value.strip():
            raise ValueError("Enter your name.")
        return value.strip()


class PasswordLogin(Input):
    email: str = Field(min_length=6, max_length=254)
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().casefold()
        if "@" not in value or "." not in value.rsplit("@", 1)[-1] or any(c.isspace() for c in value):
            raise ValueError("Enter a valid email address.")
        return value


class PasswordResetRequest(Input):
    email: str = Field(min_length=6, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = value.strip().casefold()
        if "@" not in value or "." not in value.rsplit("@", 1)[-1] or any(c.isspace() for c in value):
            raise ValueError("Enter a valid email address.")
        return value


class PasswordAction(Input):
    token: str = Field(min_length=32, max_length=128)


class PasswordReset(PasswordAction):
    password: str = Field(min_length=8, max_length=128)


class SourceUploadSession(Input):
    name: str = Field(min_length=1, max_length=200)
    size: int = Field(ge=1, le=10 * 1024 * 1024)


class AccountProfile(Input):
    display_name: str = Field(min_length=1, max_length=80)
    bio: str = Field(default="", max_length=300)
    study_goal: str = Field(default="", max_length=160)
    avatar: Literal["initials", "book", "spark", "plant", "rocket", "cat"] = "initials"
    color: Literal["purple", "blue", "green", "orange", "pink"] = "purple"

    @field_validator("display_name")
    @classmethod
    def trim_display_name(cls, value):
        if not value.strip():
            raise ValueError("A display name is required.")
        return value.strip()


class NotebookInput(Input):
    id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    name: str = Field(min_length=1, max_length=80)
    color: Literal["purple", "blue", "green", "orange", "pink"] = "purple"

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if not value.strip():
            raise ValueError("A name is required.")
        return value.strip()


class NoteInput(Input):
    id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    title: str = Field(default="Untitled note", max_length=200)
    content: str = Field(default="", max_length=200_000)
    document: dict | None = None
    revision: int | None = Field(default=None, ge=0)

    @field_validator("document")
    @classmethod
    def bound_editor_document(cls, value):
        import json

        if value and len(json.dumps(value)) > 200_000:
            raise ValueError("This note is too large. Split it into smaller notes.")
        return value


class Rename(Input):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def trim(cls, value):
        if not value.strip():
            raise ValueError("A name is required.")
        return value.strip()


class Selection(Input):
    source_ids: list[str] | None = Field(default=None, max_length=100)


class ChatInput(Selection):
    question: str = Field(min_length=1, max_length=8000)
    conversation_id: str | None = None


class GenerationInput(Selection):
    kind: Literal["flashcards", "quiz", "mindmap", "guide"]
    topic: str = Field(default="", max_length=500)
    count: int = Field(default=8, ge=1, le=30)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    pages: list[int] | None = Field(default=None, min_length=1, max_length=1000)
    style: Literal["detailed", "concise", "questions"] = "detailed"

    @field_validator("pages")
    @classmethod
    def positive_pages(cls, value):
        if value is not None and (
            any(p < 1 or p > 1000 for p in value) or len(value) != len(set(value))
        ):
            raise ValueError("Choose unique page numbers between 1 and 1000.")
        return sorted(value) if value else value


class CardDraft(Input):
    question: str = Field(min_length=3, max_length=1500)
    answer: str = Field(min_length=1, max_length=3000)
    source_ids: list[str] = Field(min_length=1, max_length=10)
    concept: str = Field(min_length=1, max_length=200)


class CardBatch(Input):
    cards: list[CardDraft] = Field(min_length=1, max_length=30)


class QuizQuestion(Input):
    question: str = Field(min_length=3, max_length=1500)
    options: list[str] = Field(min_length=4, max_length=4)
    correct: int = Field(ge=0, le=3)
    explanation: str = Field(min_length=1, max_length=3000)
    source_ids: list[str] = Field(min_length=1)
    concept: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def unique_options(self):
        if len({s.strip().casefold() for s in self.options}) != 4 or any(
            not x.strip() for x in self.options
        ):
            raise ValueError("Questions need four distinct nonempty choices.")
        return self


class QuizBatch(Input):
    questions: list[QuizQuestion] = Field(min_length=1, max_length=30)


class Concept(Input):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=200)
    source_ids: list[str] = Field(min_length=1)


class Relation(Input):
    source: str
    target: str
    label: str = Field(max_length=100)


class ConceptMap(Input):
    nodes: list[Concept] = Field(min_length=1, max_length=40)
    edges: list[Relation] = Field(max_length=80)


class GroundedAnswer(Input):
    answer: str = Field(min_length=1, max_length=15000)
    source_ids: list[str]
    citations: list["Citation"] = Field(default_factory=list, max_length=15)


class CardUpdate(Input):
    question: str = Field(min_length=1, max_length=1500)
    answer: str = Field(min_length=1, max_length=3000)
    accepted: bool = False


class ReviewInput(Input):
    rating: int = Field(ge=1, le=4)
    event_id: str = Field(min_length=1, max_length=100)
    assisted: bool = False


class AttemptInput(Input):
    mode: Literal["practice", "exam"] = "practice"


class ArtifactQuizQuestion(Input):
    id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=1500)
    options: list[dict] = Field(default_factory=list, max_length=6)
    correct: str = Field(min_length=1, max_length=10)
    explanation: str = Field(default="", max_length=3000)
    concept: str = Field(default="", max_length=200)
    source_ids: list[str] = Field(default_factory=list, max_length=20)


class ArtifactQuiz(Input):
    id: str = Field(min_length=1, max_length=100)
    notebook: str = Field(min_length=1, max_length=100)
    kind: Literal["quiz"] = "quiz"
    title: str = Field(default="", max_length=200)
    questions: list[ArtifactQuizQuestion] = Field(min_length=1, max_length=50)


class ArtifactFlashcard(Input):
    id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=1500)
    answer: str = Field(min_length=1, max_length=3000)
    concept: str = Field(default="", max_length=200)
    source_ids: list[str] = Field(default_factory=list, max_length=20)


class ArtifactFlashcards(Input):
    id: str = Field(min_length=1, max_length=100)
    notebook: str = Field(min_length=1, max_length=100)
    kind: Literal["flashcards"] = "flashcards"
    title: str = Field(default="", max_length=200)
    cards: list[ArtifactFlashcard] = Field(min_length=1, max_length=50)


class ArtifactNode(Input):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    source_ids: list[str] = Field(default_factory=list, max_length=20)


class ArtifactEdge(Input):
    source: str = Field(min_length=1, max_length=100)
    target: str = Field(min_length=1, max_length=100)
    label: str = Field(default="", max_length=100)


class ArtifactMindmap(Input):
    id: str = Field(min_length=1, max_length=100)
    notebook: str = Field(min_length=1, max_length=100)
    kind: Literal["mindmap"] = "mindmap"
    title: str = Field(default="", max_length=200)
    nodes: list[ArtifactNode] = Field(min_length=1, max_length=60)
    edges: list[ArtifactEdge] = Field(default_factory=list, max_length=100)


class ArtifactGuideQuestion(Input):
    id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=1500)
    answer: str = Field(min_length=1, max_length=3000)
    concept: str = Field(default="", max_length=200)
    source_ids: list[str] = Field(default_factory=list, max_length=20)


class ArtifactGuide(Input):
    id: str = Field(min_length=1, max_length=100)
    notebook: str = Field(min_length=1, max_length=100)
    kind: Literal["guide"] = "guide"
    title: str = Field(default="", max_length=200)
    questions: list[ArtifactGuideQuestion] = Field(default_factory=list, max_length=50)


ArtifactInput = ArtifactQuiz | ArtifactFlashcards | ArtifactMindmap | ArtifactGuide


def validate_artifact(value):
    """Validate an imported artifact against its kind-specific schema.

    Pydantic unions do not expose a model_validate shortcut, so the matching
    variant is selected explicitly. Unknown kinds raise ValueError.
    """
    kind = value.get("kind")
    for variant in (ArtifactQuiz, ArtifactFlashcards, ArtifactMindmap, ArtifactGuide):
        if variant.model_fields.get("kind").default == kind:
            return variant.model_validate(value)
    raise ValueError("Artifact kind must be quiz, flashcards, mindmap, or guide.")


class Submission(Input):
    answers: dict[str, str]


class PracticeCheck(Input):
    question_id: str
    option_id: str


class GraphInput(Input):
    nodes: list[dict] = Field(max_length=100)
    edges: list[dict] = Field(max_length=200)
    viewport: dict | None = None
    revision: int | None = None


class FocusInput(Input):
    duration: int = Field(ge=60, le=10800)
    mode: Literal["focus", "short", "long"] = "focus"
    notebook: str | None = None


class FocusAction(Input):
    action: Literal["pause", "resume", "complete", "cancel"]


class TaskInput(Input):
    text: str = Field(min_length=1, max_length=500)
    done: bool = False


# --- Manual creation (no AI required) ---


class ManualCardInput(Input):
    question: str = Field(min_length=3, max_length=1500)
    answer: str = Field(min_length=1, max_length=3000)
    concept: str = Field(min_length=1, max_length=200)


class ManualDeckInput(Input):
    title: str = Field(min_length=1, max_length=200)
    cards: list[ManualCardInput] = Field(default_factory=list, max_length=30)


class ManualQuestionInput(Input):
    question: str = Field(min_length=3, max_length=1500)
    options: list[str] = Field(min_length=4, max_length=4)
    correct: int = Field(ge=0, le=3)
    explanation: str = Field(min_length=1, max_length=3000)
    concept: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def unique_options(self):
        if len({s.strip().casefold() for s in self.options}) != 4 or any(
            not x.strip() for x in self.options
        ):
            raise ValueError("Questions need four distinct nonempty choices.")
        return self


class ManualQuizInput(Input):
    title: str = Field(min_length=1, max_length=200)
    questions: list[ManualQuestionInput] = Field(default_factory=list, max_length=30)


class Citation(Input):
    source_id: str
    page: int | None = Field(default=None, ge=1)
    section: int | None = Field(default=None, ge=1)
    quote: str = Field(min_length=8, max_length=500)


class ReviewerSection(Input):
    heading: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5000)
    citations: list[Citation] = Field(min_length=1, max_length=10)


class ReviewerQuestion(Input):
    question: str = Field(min_length=3, max_length=1000)
    answer: str = Field(min_length=1, max_length=2000)
    citations: list[Citation] = Field(min_length=1, max_length=5)


class ReviewerBatch(Input):
    title: str = Field(min_length=1, max_length=200)
    overview: str = Field(min_length=1, max_length=2000)
    sections: list[ReviewerSection] = Field(min_length=1, max_length=8)
    practice_questions: list[ReviewerQuestion] = Field(
        default_factory=list, max_length=8
    )
    warnings: list[str] = Field(default_factory=list, max_length=10)


class ReviewerNoteOptions(Input):
    """Choose which parts of a reviewer are copied into a note."""

    include_summary: bool = True
    include_sections: bool = True
    include_practice: bool = True
    include_disclaimer: bool = True

    @model_validator(mode="after")
    def keep_at_least_one_section(self):
        if not any(
            (
                self.include_summary,
                self.include_sections,
                self.include_practice,
                self.include_disclaimer,
            )
        ):
            raise ValueError("Choose at least one part of the reviewer to save.")
        return self


class SearchBriefInput(Input):
    query: str = Field(min_length=2, max_length=200)
    sources: list[str] = Field(default_factory=list, max_length=6)
    sort: Literal["relevance", "newest"] = "relevance"

    @field_validator("query")
    @classmethod
    def trim_query(cls, value):
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Enter a topic to search.")
        return value


class BriefPoint(Input):
    """One idea in a brief. Empty evidence_ids means general knowledge."""

    text: str = Field(
        min_length=1,
        max_length=800,
        description=(
            "One complete sentence of 10-30 words with a concrete definition, "
            "example, component, or practical use. No vague filler."
        ),
    )
    evidence_ids: list[str] = Field(default_factory=list, max_length=6)


class BriefSection(Input):
    heading: str = Field(min_length=1, max_length=120)
    points: list[BriefPoint] = Field(min_length=1, max_length=6)


class SearchBrief(Input):
    title: str = Field(min_length=1, max_length=160)
    overview: str = Field(
        min_length=1,
        max_length=1200,
        description="2-4 plain-English sentences that define and introduce the topic.",
    )
    overview_evidence_ids: list[str] = Field(default_factory=list, max_length=8)
    sections: list[BriefSection] = Field(min_length=1, max_length=6)
    key_terms: list[str] = Field(default_factory=list, max_length=12)
    further_reading: list[str] = Field(default_factory=list, max_length=8)


class FeedbackInput(Input):
    category: str = Field(default="general", max_length=50)
    subject: str = Field(min_length=1, max_length=150)
    message: str = Field(min_length=1, max_length=3000)
    priority: str = Field(default="medium", max_length=20)
    page_url: str | None = Field(default=None, max_length=500)


class AdminFeedbackUpdate(Input):
    status: str = Field(min_length=1, max_length=50)
    admin_notes: str | None = Field(default=None, max_length=2000)


class UserActivityInput(Input):
    action: str = Field(min_length=1, max_length=100)
    target: str = Field(min_length=1, max_length=200)
    metadata: str | None = Field(default=None, max_length=1000)


class ClientErrorInput(Input):
    error_type: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=2000)
    stack_trace: str | None = Field(default=None, max_length=10000)
    affected_page: str | None = Field(default=None, max_length=500)
    severity: str = Field(default="error", max_length=20)


class AdminErrorUpdate(Input):
    status: str = Field(min_length=1, max_length=50)

