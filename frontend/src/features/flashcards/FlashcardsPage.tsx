import { useState, useEffect } from "react";
import {
  Layers,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Check,
  Trash2,
  Plus,
  Save,
  X,
  ArrowRight,
  Sparkles,
  FileText,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { api, json } from "../../api";
import { useStore } from "../../store";
import { Title, Evidence, useArtifacts } from "../study/StudyShared";

type ManualCard = {
  question: string;
  answer: string;
  concept: string;
};

export default function Flashcards() {
  const a = useArtifacts("flashcards");
  const [mode, setMode] = useState("draft");
  const [index, setIndex] = useState(0);
  const [flip, setFlip] = useState(false);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  // Manual deck creation wizard
  const [creatingDeck, setCreatingDeck] = useState(false);
  const [wizardStep, setWizardStep] = useState(0); // 0 = title, 1 = cards
  const [deckTitle, setDeckTitle] = useState("");
  const [newCardQ, setNewCardQ] = useState("");
  const [newCardA, setNewCardA] = useState("");
  const [newCardConcept, setNewCardConcept] = useState("");
  const [deckCards, setDeckCards] = useState<ManualCard[]>([]);
  const cards = (a.artifact?.cards || []).filter((c: any) =>
    mode === "draft"
      ? !c.accepted
      : c.accepted &&
        (mode !== "due" ||
          !c.schedule ||
          new Date(JSON.parse(c.schedule).due) <= new Date()),
  );
  const card = cards[index % Math.max(1, cards.length)];
  useEffect(() => {
    setIndex(0);
    setFlip(false);
    setEditing(false);
  }, [a.active, mode]);
  async function save(accepted: boolean) {
    if (!card || saving) return;
    setSaving(true);
    try {
      await api(`/decks/${a.active}/cards/${card.id}`, {
        method: "PATCH",
        body: json({
          question: editing ? question : card.question,
          answer: editing ? answer : card.answer,
          accepted,
        }),
      });
      setEditing(false);
      setFlip(false);
      await a.reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function review(rating: number) {
    if (saving) return;
    setSaving(true);
    try {
      const result = await api(`/decks/${a.active}/cards/${card.id}/reviews`, {
        method: "POST",
        body: json({ rating, event_id: crypto.randomUUID(), assisted: false }),
      });
      toast.success(`Next review: ${new Date(result.due).toLocaleString()}`);
      setFlip(false);
      if (mode !== "due") setIndex(index + 1);
      await a.reload();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function createDeck() {
    if (!deckTitle.trim() || !useStore.getState().active) return;
    setSaving(true);
    try {
      const result = await api(
        `/notebooks/${useStore.getState().active}/decks`,
        {
          method: "POST",
          body: json({
            title: deckTitle.trim(),
            cards: deckCards.map((c) => ({
              question: c.question,
              answer: c.answer,
              concept: c.concept,
            })),
          }),
        },
      );
      await a.reload();
      setCreatingDeck(false);
      setWizardStep(0);
      setDeckTitle("");
      setNewCardQ("");
      setNewCardA("");
      setNewCardConcept("");
      setDeckCards([]);
      toast.success(`Deck "${result.title || deckTitle}" created.`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  function addDeckCard() {
    if (!newCardQ.trim() || !newCardA.trim() || !newCardConcept.trim()) return;
    setDeckCards((prev) => [
      ...prev,
      { question: newCardQ, answer: newCardA, concept: newCardConcept },
    ]);
    setNewCardQ("");
    setNewCardA("");
    setNewCardConcept("");
  }
  function removeDeckCard(cardIndex: number) {
    setDeckCards((prev) => prev.filter((_, i) => i !== cardIndex));
  }
  return (
    <section className="feature-screen flashcards-screen">
      <Title
        label="ACTIVE RECALL / CARD STUDIO"
        title="Little cards. Lasting knowledge."
        desc="A focused space to recall, reveal, and revisit what you learn."
      />
      <div className="deck-summary">
        <div>
          <Layers size={22} />
          <span>
            <b>{a.items.length}</b> saved decks
          </span>
        </div>
        <div>
          <b>
            {a.items.reduce(
              (count, item) => count + (item.cards?.length || 0),
              0,
            )}
          </b>
          <span> cards in your collection</span>
        </div>
        <span className="deck-method">Recall → Reveal → Repeat</span>
      </div>
      {a.controls}
      <div className="study-tabs">
        {[
          ["draft", "Review drafts"],
          ["practice", "Quick practice"],
          ["due", "Due for review"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={mode === value ? "active" : ""}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {card ? (
        <div className="flashcard-area">
          <span className="eyebrow">
            CARD {(index % cards.length) + 1} OF {cards.length} ·{" "}
            {mode === "draft" ? "DRAFT" : "ACCEPTED"}
          </span>
          {editing ? (
            <div className="card-edit">
              <label>
                Question
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </label>
              <label>
                Answer
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={saving || !question.trim() || !answer.trim()}
                onClick={() => save(card.accepted)}
              >
                Save edits
              </button>
              <button className="secondary" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className={`flashcard ${flip ? "flipped" : ""}`}
              onClick={() => setFlip(!flip)}
            >
              <span className="tool-icon purple">
                <Layers />
              </span>
              <small>{flip ? "ANSWER" : "QUESTION"}</small>
              <h2>{flip ? card.answer : card.question}</h2>
              <p>
                {flip
                  ? card.concept
                  : "Think of your answer, then click to reveal."}
              </p>
            </button>
          )}
          <Evidence ids={card.source_ids} />
          <div className="card-controls">
            <button
              className="secondary"
              onClick={() => {
                setIndex((index - 1 + cards.length) % cards.length);
                setFlip(false);
                setEditing(false);
              }}
            >
              <ChevronLeft size={15} />
              Previous
            </button>
            <button className="primary" onClick={() => setFlip(!flip)}>
              <RotateCcw size={15} />
              Flip card
            </button>
            <button
              className="secondary"
              onClick={() => {
                setIndex(index + 1);
                setFlip(false);
                setEditing(false);
              }}
            >
              Next
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="card-controls">
            <button
              className="secondary"
              onClick={() => {
                setQuestion(card.question);
                setAnswer(card.answer);
                setEditing(true);
              }}
            >
              Edit card
            </button>
            {mode === "draft" && (
              <>
                <button
                  className="primary"
                  disabled={saving}
                  onClick={() => save(true)}
                >
                  <Check size={15} />
                  Accept card
                </button>
                <button
                  className="secondary"
                  disabled={saving}
                  onClick={async () => {
                    try {
                      await api(`/decks/${a.active}/cards/${card.id}`, {
                        method: "DELETE",
                      });
                      await a.reload();
                    } catch (e: any) {
                      toast.error(e.message);
                    }
                  }}
                >
                  <Trash2 size={15} />
                  Discard draft
                </button>
              </>
            )}
          </div>
          {mode === "due" && flip && (
            <div className="review-ratings">
              {["Again", "Hard", "Good", "Easy"].map((label, i) => (
                <button
                  key={label}
                  className="secondary"
                  disabled={saving}
                  onClick={() => review(i + 1)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="deck-empty">
          <div className="empty-card-stack" aria-hidden="true">
            <span />
            <span />
            <span>
              <Layers size={35} />
            </span>
          </div>
          <span className="eyebrow">YOUR NEXT STUDY SESSION</span>
          <h2>
            {mode === "due"
              ? "A little breathing room."
              : "Build a collection worth remembering."}
          </h2>
          {creatingDeck ? (
            <div className="wizard-panel">
              <div className="wizard-steps">
                {[
                  { label: "Deck title", done: wizardStep > 0 },
                  { label: "Add cards", done: wizardStep > 1, active: wizardStep === 1 },
                ].map((step, i) => (
                  <div
                    key={i}
                    className={`wizard-step ${step.done ? "done" : ""} ${
                      step.active ? "active" : ""
                    }`}
                  >
                    <span className="step-number">{i + 1}</span>
                    <span className="step-label">{step.label}</span>
                  </div>
                ))}
              </div>
              {wizardStep === 0 ? (
                <div className="wizard-step-content">
                  <label className="field-label">Deck title</label>
                  <input
                    className="field-input"
                    value={deckTitle}
                    onChange={(e) => setDeckTitle(e.target.value)}
                    placeholder="e.g. Biology Chapter 1"
                  />
                  <p className="field-hint">
                    Give your deck a name so you can find it later.
                  </p>
                  <div className="wizard-actions">
                    <button
                      className="secondary ghost"
                      onClick={() => setCreatingDeck(false)}
                      disabled={saving}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                    <button
                      className="primary"
                      onClick={() => setWizardStep(1)}
                      disabled={saving || !deckTitle.trim()}
                    >
                      <ArrowRight size={14} />
                      Add cards
                    </button>
                  </div>
                </div>
              ) : (
                <div className="wizard-step-content">
                  <label className="field-label">Add flashcards</label>
                  <p className="field-hint">
                    Enter questions and answers one at a time.
                  </p>
                  <div className="card-form-row">
                    <div className="input-group">
                      <label className="field-label">Question</label>
                      <input
                        className="field-input"
                        value={newCardQ}
                        onChange={(e) => setNewCardQ(e.target.value)}
                        placeholder="What is the capital of France?"
                      />
                    </div>
                    <div className="input-group">
                      <label className="field-label">Answer</label>
                      <input
                        className="field-input"
                        value={newCardA}
                        onChange={(e) => setNewCardA(e.target.value)}
                        placeholder="Paris"
                      />
                    </div>
                    <div className="input-group">
                      <label className="field-label">Concept</label>
                      <input
                        className="field-input"
                        value={newCardConcept}
                        onChange={(e) => setNewCardConcept(e.target.value)}
                        placeholder="e.g. Geography"
                      />
                    </div>
                    <button
                      className="add-card-btn"
                      onClick={addDeckCard}
                      disabled={
                        saving ||
                        !newCardQ.trim() ||
                        !newCardA.trim() ||
                        !newCardConcept.trim()
                      }
                    >
                      <Plus size={14} />
                      Add card
                    </button>
                  </div>
                  {deckCards.length > 0 && (
                    <div className="card-list">
                      <p className="card-list-count">
                        {deckCards.length} card{
                          deckCards.length !== 1 ? "s" : ""
                        } added
                      </p>
                      {deckCards.map((c, i) => (
                        <div
                          key={i}
                          className="card-item"
                        >
                          <div className="card-item-content">
                            <div className="card-item-q">
                              <span className="badge q-badge">Q</span>
                              {c.question}
                            </div>
                            <div className="card-item-a">
                              <span className="badge a-badge">A</span>
                              {c.answer}
                            </div>
                            <span className="concept-chip">{c.concept}</span>
                          </div>
                          <button
                            className="remove-card-btn"
                            onClick={() => removeDeckCard(i)}
                            aria-label="Remove card"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="wizard-actions">
                    <button
                      className="secondary ghost"
                      onClick={() => setWizardStep(0)}
                      disabled={saving}
                    >
                      <ArrowRight size={14} rotate={180} />
                      Back
                    </button>
                    <button
                      className="primary"
                      onClick={createDeck}
                      disabled={
                        saving ||
                        !deckTitle.trim() ||
                        deckCards.length === 0 ||
                        !useStore.getState().active
                      }
                    >
                      {saving ? "Creating…" : <><Save size={14} /> Create deck</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <p>
                {mode === "draft"
                  ? "Your saved decks will appear here. Or create a deck manually — no AI needed."
                  : mode === "due"
                    ? "No cards are due right now. Come back later or use quick practice."
                    : "Accept a few draft cards to begin practice."}
              </p>
              {!useStore.getState().active ? (
                <p className="muted">
                  Create a notebook first to store your decks.
                </p>
              ) : (
                <button
                  className="primary"
                  onClick={() => {
                    setCreatingDeck(true);
                    setWizardStep(0);
                  }}
                  disabled={saving}
                >
                  <Plus size={16} />
                  Create new deck
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
