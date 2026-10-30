import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Sparkles,
  Files,
  BookOpen,
  PanelRight,
  ArrowUp,
  Loader2,
  FileText,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../../store";
import { api, json, waitForJob } from "../../api";
import { useAI, AIAccess } from "../ai/AIAccess";
type Citation = {
  source_id: string;
  name: string;
  page?: number;
  section?: number;
  quote?: string;
};
type Message = {
  id: string;
  role: string;
  text: string;
  citations?: Citation[];
  ai?: { provider: string; model: string };
};
function aiErrorMessage(error: {
  message?: string;
  kind?: string;
  status?: number;
  retryAfter?: number;
}) {
  if (
    error.kind === "quota" ||
    error.kind === "rate_limit" ||
    error.status === 429 ||
    error.retryAfter
  )
    return "Free-tier AI quota is temporarily exhausted. Your work is saved; try again when the quota resets.";
  if (error.kind === "refused")
    return "The AI provider declined this request. Try a different question or narrower source selection.";
  if (error.kind === "invalid_response")
    return "The AI response did not pass the source or format checks. Try a narrower question or another source selection.";
  if (error.kind === "permission")
    return error.message || "AI is not available for this account yet.";
  if (error.kind === "connection" || (error.status || 0) >= 500)
    return "Could not reach an AI provider. Check the connection and try again.";
  return error.message || "The question could not be completed. Try again.";
}
export default function AssistantPage() {
  const s = useStore();
  const navigate = useNavigate();
  const ai = useAI();
  const [params] = useSearchParams();
  const [references, setReferences] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState(params.get("question") || "");
  const [pending, setPending] = useState("");
  const [queuedJob, setQueuedJob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [citation, setCitation] = useState<Citation | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const sources = s.sources.filter((x) => x.notebook === s.active);
  useEffect(() => {
    active.current = true;
    setMessages([]);
    setError("");
    if (s.active)
      api(`/notebooks/${s.active}/conversation`)
        .then((data) => {
          if (active.current) setMessages(data.messages);
        })
        .catch((e) => {
          if (active.current) setError(e.message);
        });
    return () => {
      active.current = false;
    };
  }, [s.active]);
  useEffect(() => {
    let current = true;
    if (s.active)
      api(`/notebooks/${s.active}/jobs`)
        .then((jobs) => {
          const job = jobs.find(
            (j: any) =>
              j.kind === "chat" &&
              ["queued", "processing", "waiting"].includes(j.status),
          );
          if (current && job) {
            setQueuedJob(job.id);
            setQuestion(job.question);
            setError(
              "Your saved question is waiting for free AI availability.",
            );
          }
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [s.active]);
  useEffect(() => {
    if (!queuedJob) return;
    let current = true;
    const poll = async () => {
      try {
        const job = await api(`/jobs/${queuedJob}`);
        if (!current) return;
        if (job.status === "completed") {
          const history = await api(`/notebooks/${s.active}/conversation`);
          if (current) {
            setMessages(history.messages);
            setQueuedJob("");
            setQuestion("");
            setError("");
          }
        } else if (job.status === "failed") {
          setQueuedJob("");
          setError(
            aiErrorMessage({
              message: job.error,
              kind: job.error_kind,
            }),
          );
        } else if (job.status === "waiting" && job.retry_at) {
          const retryTime = new Date(job.retry_at * 1000).getTime();
          if (Date.now() >= retryTime) {
            try {
              await api(`/jobs/${queuedJob}/retry`, { method: "POST" });
              setError("Retrying your question…");
            } catch (e: any) {
              setError(e.message || "Retry failed. Please try again.");
            }
          } else {
            setError(
              `${job.error || "AI temporarily unavailable."} Retrying after ${new Date(job.retry_at * 1000).toLocaleTimeString()}.`,
            );
          }
        }
      } catch {}
    };
    const timer = window.setInterval(poll, 5000);
    poll();
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [queuedJob, s.active]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, busy]);
  async function ask(text = question) {
    if (!text.trim() || busy || !ai.ready || queuedJob) return;
    if (Date.now() < retryAt) {
      setError(
        `Free quota is cooling down. Retry after ${new Date(retryAt).toLocaleTimeString()}.`,
      );
      return;
    }
    const notebook = s.active,
      owner = s.owner;
    setBusy(true);
    setPending(text);
    setError("");
    try {
      await s.flush();
      const answer = await api<any>(`/notebooks/${notebook}/messages`, {
        method: "POST",
        body: json({
          question: text,
          source_ids: useStore.getState().selectedSources,
        }),
      });
      if (answer.job_id) {
        if (active.current) {
          setQueuedJob(answer.job_id);
          setError(
            `${answer.error || "Free-tier AI quota is temporarily exhausted. Your question is saved."} Retrying after ${new Date(answer.retry_at * 1000).toLocaleTimeString()}.`,
          );
        }
        return;
      }
      if (
        active.current &&
        useStore.getState().active === notebook &&
        useStore.getState().owner === owner
      ) {
        setMessages((old) => [
          ...old,
          { id: crypto.randomUUID(), role: "user", text },
          answer,
        ]);
        setQuestion("");
        setRetryAt(0);
      }
    } catch (e: any) {
      if (active.current) {
        setError(aiErrorMessage(e));
        if (e.retryAfter) setRetryAt(Date.now() + e.retryAfter * 1000);
      }
    } finally {
      if (active.current) {
        setBusy(false);
        setPending("");
      }
    }
  }
  async function saveNote(message: Message) {
    const noteId = crypto.randomUUID();
    s.set({
      notes: [
        ...s.notes,
        {
          id: noteId,
          notebook: s.active,
          title: "Study explanation",
          content: "",
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: message.text }],
              },
              ...(message.citations?.map((c) => ({
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: `${c.name}${c.page ? ` · page ${c.page}` : ""}${c.quote ? `: ${c.quote}` : ""}`,
                  },
                ],
              })) || []),
            ],
          },
        },
      ],
    });
    try {
      await useStore.getState().flush();
      navigate(`/notes?note=${noteId}`);
      toast.success("Explanation added to Notes.");
    } catch (error: any) {
      toast.error(error.message);
    }
  }
  return (
    <section className="feature-screen assistant-screen">
      <div className="feature-heading">
        <div>
          <span className="eyebrow">YOUR THINKING PARTNER</span>
          <h1>The conversation workspace</h1>
          <p>Your questions, with your study material close at hand.</p>
        </div>
        <button
          className="secondary"
          onClick={() => setReferences(!references)}
          aria-expanded={references}
        >
          <PanelRight size={16} />
          References
        </button>
      </div>
      <AIAccess ai={ai} />
      <div
        className={`assistant-workspace ${references ? "" : "references-hidden"}`}
      >
        <div className="assistant-conversation">
          <div className="live-chat-history" aria-live="polite">
            {!messages.length && !busy ? (
              <div className="assistant-center">
                <span className="assistant-orb">
                  <Sparkles size={32} />
                </span>
                <span className="eyebrow">
                  A LITTLE CURIOSITY GOES A LONG WAY
                </span>
                <h2>What will you understand next?</h2>
                <p>
                  Ask about your selected sources. Answers include checked
                  source quotes, and the conversation stays in CdMento when
                  providers switch.
                </p>
                <div className="assistant-prompts">
                  {[
                    "Explain the main concepts in my sources",
                    "Compare two important ideas",
                    "Walk me through an example",
                  ].map((t) => (
                    <button
                      disabled={
                        !ai.ready || !sources.some((f) => f.status === "ready")
                      }
                      key={t}
                      onClick={() => ask(t)}
                    >
                      {t}
                      <ArrowUp size={14} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <article className={`message ${m.role}`} key={m.id}>
                  <small title={m.ai ? `${m.ai.provider} · ${m.ai.model}` : undefined}>
                    {m.role === "user" ? "YOU" : "CDMENTO"}
                  </small>
                  <p>{m.text}</p>
                  {m.citations?.length ? (
                    <>
                      <div className="citation-list">
                        {m.citations.map((c, i) => (
                          <button key={i} onClick={() => setCitation(c)}>
                            <FileText size={12} />
                            {c.name}
                            {c.page ? ` · p. ${c.page}` : ""}
                          </button>
                        ))}
                      </div>
                      <button
                        className="text-button"
                        onClick={() => saveNote(m)}
                      >
                        <Save size={12} />
                        Save to Notes
                      </button>
                    </>
                  ) : null}
                </article>
              ))
            )}
            {busy && (
              <>
                <article className="message user">
                  <small>YOU</small>
                  <p>{pending}</p>
                </article>
                <p className="thinking">
                  <Loader2 size={15} className="spin" />
                  Checking your sources…
                </p>
              </>
            )}
            <div ref={end} />
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <form
            className="assistant-composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={8000}
              disabled={!ai.ready || busy || !!queuedJob}
              placeholder={
                ai.loading
                  ? "Checking AI connection…"
                  : ai.ready
                    ? "Ask about your selected sources…"
                    : "AI is temporarily unavailable. Your question will be saved…"
              }
              aria-label="Assistant question"
            />
            <button
              className="primary"
              disabled={
                !ai.ready ||
                busy ||
                !question.trim() ||
                !sources.some((f) => f.status === "ready")
              }
              aria-label="Send question"
            >
              <ArrowUp size={18} />
            </button>
          </form>
          <p className="small-print">
            AI can make mistakes. Open citations to compare the answer with its
            source.
          </p>
        </div>
        {references && (
          <aside className="assistant-references">
            <h3>
              <Files size={17} />
              Reference desk
            </h3>
            <p>Documents in your active notebook</p>
            {sources.map((f) => (
              <button
                key={f.id}
                onClick={() =>
                  navigate(`/sources?source=${encodeURIComponent(f.id)}`)
                }
              >
                <BookOpen size={17} />
                <span>
                  {f.name}
                  <small>{f.status}</small>
                </span>
              </button>
            ))}
            {!sources.length && <p>No sources added yet.</p>}
            <button className="secondary" onClick={() => navigate("/sources")}>
              Manage sources
            </button>
          </aside>
        )}
      </div>
      {citation && (
        <div className="modal-backdrop" onClick={() => setCitation(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Answer evidence"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close evidence"
              onClick={() => setCitation(null)}
            >
              <X />
            </button>
            <h2>{citation.name}</h2>
            <p>
              {citation.page
                ? `Page ${citation.page}`
                : `Section ${citation.section || 1}`}
            </p>
            <blockquote>
              {citation.quote ||
                "Open the original source to verify this saved answer."}
            </blockquote>
            <button
              className="primary"
              onClick={() =>
                navigate(
                  `/sources?source=${encodeURIComponent(citation.source_id)}${citation.page ? `&page=${citation.page}` : ""}`,
                )
              }
            >
              Open source
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
