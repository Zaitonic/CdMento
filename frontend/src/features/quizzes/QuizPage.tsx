import { useState, useEffect } from "react";
import { ArrowRight, CheckCircle2, Sparkles, Check, Plus, X, Settings } from "lucide-react";
import { toast } from "sonner";
import { api, json } from "../../api";
import { Title, Evidence, useArtifacts } from "../study/StudyShared";
import { useStore } from "../../store";

type ManualQuizQuestion = {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  concept: string;
};

export default function Quiz() {
  const a = useArtifacts("quiz");
  const [mode, setMode] = useState("practice");
  const [attempt, setAttempt] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  // Manual quiz creation wizard
  const [creatingQuiz, setCreatingQuiz] = useState(false);
  const [wizardStep, setWizardStep] = useState(0); // 0 = title, 1 = questions
  const [quizTitle, setQuizTitle] = useState("");
  const [qQuestion, setQQuestion] = useState("");
  const [qOptions, setQOptions] = useState(["", "", "", ""]);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState("");
  const [qConcept, setQConcept] = useState("");
  const [quizQuestions, setQuizQuestions] = useState<ManualQuizQuestion[]>([]);

  useEffect(() => {
    setAttempt(null);
    setResult(null);
    setAnswers({});
    setIndex(0);
    setFeedback(null);
  }, [a.active]);

  const question = attempt?.questions[index];

  async function start() {
    setBusy(true);
    try {
      const data = await api(`/quizzes/${a.active}/attempts`, {
        method: "POST",
        body: json({ mode }),
      });
      setAttempt(data);
      setResult(null);
      setAnswers({});
      setIndex(0);
      setFeedback(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (busy || !question) return;
    setBusy(true);
    try {
      if (mode === "practice" && !feedback) {
        setFeedback(
          await api(`/attempts/${attempt.id}/check`, {
            method: "POST",
            body: json({
              question_id: question.id,
              option_id: answers[question.id],
            }),
          }),
        );
        return;
      }
      if (index === attempt.questions.length - 1) {
        setResult(
          await api(`/attempts/${attempt.id}/submit`, {
            method: "POST",
            body: json({ answers }),
          }),
        );
        setAttempt(null);
      } else {
        setIndex(index + 1);
        setFeedback(null);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createQuiz() {
    if (!quizTitle.trim() || quizQuestions.length === 0 || !useStore.getState().active)
      return;
    setBusy(true);
    try {
      const result = await api(
        `/notebooks/${useStore.getState().active}/quizzes`,
        {
          method: "POST",
          body: json({
            title: quizTitle.trim(),
            questions: quizQuestions.map((q) => ({
              question: q.question,
              options: q.options,
              correct: q.correct,
              explanation: q.explanation,
              concept: q.concept,
            })),
          }),
        },
      );
      await a.reload();
      setCreatingQuiz(false);
      setWizardStep(0);
      setQuizTitle("");
      setQQuestion("");
      setQOptions(["", "", "", ""]);
      setQCorrect(0);
      setQExplanation("");
      setQConcept("");
      setQuizQuestions([]);
      toast.success(`Quiz "${result.title || quizTitle}" created.`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  function addQuizQuestion() {
    if (
      !qQuestion.trim() ||
      qOptions.some((o) => !o.trim()) ||
      !qExplanation.trim() ||
      !qConcept.trim()
    )
      return;
    setQuizQuestions((prev) => [
      ...prev,
      {
        question: qQuestion,
        options: [...qOptions],
        correct: qCorrect,
        explanation: qExplanation,
        concept: qConcept,
      },
    ]);
    setQQuestion("");
    setQOptions(["", "", "", ""]);
    setQCorrect(0);
    setQExplanation("");
    setQConcept("");
  }

  function removeQuizQuestion(qIndex: number) {
    setQuizQuestions((prev) => prev.filter((_, i) => i !== qIndex));
  }

  return (
    <section className="feature-screen quizzes-screen">
      <Title
        label="KNOWLEDGE CHECK / ASSESSMENTS"
        title="See what’s sticking"
        desc="Practice with explanations, or test yourself independently."
      />
      {!attempt && a.controls}
      {result ? (
        <div className="quiz-card result">
          <CheckCircle2 size={42} />
          <h2>You made progress.</h2>
          <p>{result.score} of {result.total} correct</p>
          {result.weak_concepts.length > 0 && (
            <p>Revisit: {result.weak_concepts.join(", ")}</p>
          )}
          {result.questions.map((q: any) => (
            <div className="quiz-feedback" key={q.id}>
              <b>
                {q.is_correct ? "Correct" : "Review"} · {q.question}
              </b>
              <p>{q.explanation}</p>
              <Evidence ids={q.source_ids} />
            </div>
          ))}
          <button className="primary" onClick={start}>
            Practice again
          </button>
        </div>
      ) : attempt && question ? (
        <div className="quiz-card">
          <div className="quiz-meta">
            <span>Question {index + 1} of {attempt.questions.length}</span>
            <span>
              {mode === "exam"
                ? "Exam · answers after submission"
                : "Practice · feedback as you go"}
            </span>
          </div>
          <div className="question-navigator" aria-label="Question navigation">
            {attempt.questions.map((q: any, i: number) => (
              <button
                key={q.id}
                className={
                  i === index ? "current" : answers[q.id] ? "answered" : ""
                }
                disabled={mode === "practice" && i !== index}
                onClick={() => {
                  setIndex(i);
                  setFeedback(null);
                }}
                aria-label={`Question ${i + 1}`}
                aria-current={i === index ? "step" : undefined}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <progress value={Object.keys(answers).length} max={attempt.questions.length} />
          <h2>{question.question}</h2>
          <div className="quiz-options">
            {question.options.map((o: any) => (
              <button
                disabled={!!feedback}
                className={answers[question.id] === o.id ? "chosen" : ""}
                key={o.id}
                onClick={() => setAnswers({ ...answers, [question.id]: o.id })}
              >
                <span className="radio">
                  {answers[question.id] === o.id && <Check size={12} />}
                </span>
                {o.text}
              </button>
            ))}
          </div>
          {feedback && (
            <div className="quiz-feedback">
              <b>{feedback.is_correct ? "Correct." : "Let’s revisit this."}</b>
              <p>{feedback.explanation}</p>
              <Evidence ids={feedback.source_ids} />
            </div>
          )}
          <button
            className="primary"
            disabled={busy || answers[question.id] === undefined}
            onClick={next}
          >
            {busy
              ? "Saving…"
              : mode === "practice" && !feedback
                ? "Check answer"
                : index === attempt.questions.length - 1
                  ? "Finish quiz"
                  : "Next question"}
            <ArrowRight size={16} />
          </button>
        </div>
      ) : a.artifact ? (
        <div className="quiz-card">
          <h2>Your quiz is ready</h2>
          <p>{a.artifact.questions.length} questions based on your selected sources.</p>
          <div className="study-tabs">
            {["practice", "exam"].map((value) => (
              <button
                key={value}
                className={mode === value ? "active" : ""}
                onClick={() => setMode(value)}
              >
                {value === "practice" ? "Practice" : "Exam"}
              </button>
            ))}
          </div>
          <button className="primary" disabled={busy} onClick={start}>
            Start quiz
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="quiz-setup">
          {creatingQuiz ? (
            <div className="wizard-panel">
              <div className="wizard-steps">
                {[
                  { label: "Quiz title", done: wizardStep > 0 },
                  { label: "Add questions", done: wizardStep > 1, active: wizardStep === 1 },
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
                  <label className="field-label">Quiz title</label>
                  <input
                    className="field-input"
                    value={quizTitle}
                    onChange={(e) => setQuizTitle(e.target.value)}
                    placeholder="e.g. Biology Midterm"
                  />
                  <p className="field-hint">
                    Give your quiz a name so you can find it later.
                  </p>
                  <div className="wizard-actions">
                    <button
                      className="secondary ghost"
                      onClick={() => setCreatingQuiz(false)}
                      disabled={busy}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                    <button
                      className="primary"
                      onClick={() => setWizardStep(1)}
                      disabled={busy || !quizTitle.trim()}
                    >
                      <ArrowRight size={14} />
                      Add questions
                    </button>
                  </div>
                </div>
              ) : (
                <div className="wizard-step-content">
                  <label className="field-label">Add quiz questions</label>
                  <p className="field-hint">
                    Write a question, four options, pick the correct one, and add an explanation.
                  </p>
                  <div className="card-form-row">
                    <div className="input-group full">
                      <label className="field-label">Question</label>
                      <input
                        className="field-input"
                        value={qQuestion}
                        onChange={(e) => setQQuestion(e.target.value)}
                        placeholder="What is the process by which plants make food?"
                      />
                    </div>
                  </div>
                  <div className="options-grid">
                    {["A", "B", "C", "D"].map((letter, i) => (
                      <div key={letter} className="input-group">
                        <label className="field-label">Option {letter}</label>
                        <input
                          className="field-input"
                          value={qOptions[i]}
                          onChange={(e) =>
                            setQOptions((prev) => {
                              const next = [...prev];
                              next[i] = e.target.value;
                              return next;
                            })}
                          placeholder={`Option ${letter}`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="input-group full">
                    <label className="field-label">Correct answer</label>
                    <select
                      value={qCorrect}
                      onChange={(e) => setQCorrect(Number(e.target.value))}
                    >
                      <option value={0}>Option A</option>
                      <option value={1}>Option B</option>
                      <option value={2}>Option C</option>
                      <option value={3}>Option D</option>
                    </select>
                  </div>
                  <div className="input-group full">
                    <label className="field-label">Explanation</label>
                    <input
                      className="field-input"
                      value={qExplanation}
                      onChange={(e) => setQExplanation(e.target.value)}
                      placeholder="Why is this the right answer?"
                    />
                  </div>
                  <div className="input-group full">
                    <label className="field-label">Concept / topic</label>
                    <input
                      className="field-input"
                      value={qConcept}
                      onChange={(e) => setQConcept(e.target.value)}
                      placeholder="e.g. Photosynthesis"
                    />
                  </div>
                  <button
                    className="add-question-btn"
                    onClick={addQuizQuestion}
                    disabled={
                      busy ||
                      !qQuestion.trim() ||
                      qOptions.some((o) => !o.trim()) ||
                      !qExplanation.trim() ||
                      !qConcept.trim()
                    }
                  >
                    <Plus size={14} />
                    Add question
                  </button>
                  {quizQuestions.length > 0 && (
                    <div className="question-list">
                      <p className="question-list-count">
                        {quizQuestions.length} question{
                          quizQuestions.length !== 1 ? "s" : ""
                        } added
                      </p>
                      {quizQuestions.map((q, i) => (
                        <div key={i} className="question-item">
                          <div className="question-item-content">
                            <span className="q-number">Q{i + 1}</span>
                            <span className="q-text">{q.question}</span>
                            <span className="correct-badge">
                              Correct: {String.fromCharCode(65 + q.correct)}
                            </span>
                            <span className="concept-chip">{q.concept}</span>
                          </div>
                          <button
                            className="remove-question-btn"
                            onClick={() => removeQuizQuestion(i)}
                            aria-label="Remove question"
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
                      disabled={busy}
                    >
                      <ArrowRight size={14} rotate={180} />
                      Back
                    </button>
                    <button
                      className="primary"
                      onClick={createQuiz}
                      disabled={
                        busy ||
                        !quizTitle.trim() ||
                        quizQuestions.length === 0 ||
                        !useStore.getState().active
                      }
                    >
                      {busy ? "Creating…" : <><Check size={14} /> Create quiz</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="quiz-setup-heading">
                <span className="eyebrow">ASSESSMENT SETUP</span>
                <h2>Choose how you want to practice.</h2>
                <p>
                  No saved quizzes yet. Create one manually — no AI needed — or
                  connect AI to generate from your sources.
                </p>
              </div>
              <div className="quiz-mode-grid">
                {[
                  [
                    "practice",
                    "Guided practice",
                    "Learn as you go",
                    "See explanations after each answer. Revisit the concepts that need more attention.",
                  ],
                  [
                    "exam",
                    "Independent exam",
                    "Put yourself to the test",
                    "Work through the questions independently and see your results after submission.",
                  ],
                ].map(([value, title, kicker, description]) => (
                  <button
                    key={value}
                    className={mode === value ? "selected" : ""}
                    onClick={() => setMode(value)}
                    aria-pressed={mode === value}
                  >
                    <span className="eyebrow">{kicker}</span>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <span className="mode-indicator">
                      {mode === value ? "Selected" : "Choose mode"}
                      <CheckCircle2 size={16} />
                    </span>
                  </button>
                ))}
              </div>
              {!useStore.getState().active ? (
                <p className="muted">
                  Create a notebook first to store your quizzes.
                </p>
              ) : (
                <div className="quiz-setup-footer">
                  <span>Your saved quiz will appear here when available.</span>
                  <button
                    className="primary"
                    onClick={() => {
                      setCreatingQuiz(true);
                      setWizardStep(0);
                    }}
                    disabled={busy}
                  >
                    <Plus size={16} />
                    Create new quiz
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
