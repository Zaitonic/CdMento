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
  Plus,
  Trash2,
  Clock3,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../../lib/store";
import { api, json, waitForJob } from "../../lib/api";
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
type Conversation = {
  id: string;
  notebook: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  messages?: Message[];
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
  const [params, setParams] = useSearchParams();
  const [references, setReferences] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState(params.get("conversation") || "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState(params.get("question") || "");
  const [pending, setPending] = useState("");
  const [queuedJob, setQueuedJob] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [mobileReferencesOpen, setMobileReferencesOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const sources = s.sources.filter((x) => x.notebook === s.active);
  const readySources = sources.filter((source) => source.status === "ready").length;
  useEffect(() => {
    active.current = true;
    setMessages([]);
    setError("");
    setConversationId("");
    setQueuedJob("");
    setHistory([]);
    if (!s.active) return;
    let current = true;
    const notebookId = s.active;
    api<Conversation[]>(`/notebooks/${notebookId}/conversations`)
      .then(async (threads) => {
        const requested = params.get("conversation");
        let selected = threads.find((thread) => thread.id === requested);
        if (!selected) selected = threads[0];
        if (!selected)
          selected = await api<Conversation>(`/notebooks/${notebookId}/conversations`, { method: "POST" });
        if (!current) return;
        const summary = { ...selected!, message_count: selected!.message_count ?? selected!.messages?.length ?? 0 };
        setHistory([summary, ...threads.filter((thread) => thread.id !== selected!.id)]);
        setConversationId(selected!.id);
        setParams({ conversation: selected!.id }, { replace: true });
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      active.current = false;
    };
  }, [s.active]);
  useEffect(() => {
    if (!s.active || !conversationId) return;
    let current = true;
    setMessages([]);
    api(`/notebooks/${s.active}/conversations/${conversationId}`)
      .then((thread) => {
        if (current) setMessages(thread.messages || []);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => { current = false; };
  }, [s.active, conversationId]);
  useEffect(() => {
    let current = true;
    if (s.active && conversationId)
      api(`/notebooks/${s.active}/jobs`)
        .then((jobs) => {
          const job = jobs.find(
            (j: any) =>
              j.kind === "chat" &&
              (j.conversation_id || j.notebook) === conversationId &&
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
  }, [s.active, conversationId]);
  useEffect(() => {
    if (!queuedJob) return;
    let current = true;
    const poll = async () => {
      try {
        const job = await api(`/jobs/${queuedJob}`);
        if (!current) return;
        if (job.status === "completed") {
          const history = await api(`/notebooks/${s.active}/conversations/${conversationId}`);
          if (current) {
            setMessages(history.messages);
            refreshHistory();
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
  }, [queuedJob, s.active, conversationId]);
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
      owner = s.owner,
      threadId = conversationId;
    if (!threadId) return;
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
          conversation_id: threadId,
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
        useStore.getState().owner === owner &&
        conversationId === threadId
      ) {
        setMessages((old) => [
          ...old,
          { id: crypto.randomUUID(), role: "user", text },
          answer,
        ]);
        setQuestion("");
        setRetryAt(0);
        refreshHistory();
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
  async function refreshHistory() {
    if (!s.active) return;
    try {
      const threads = await api<Conversation[]>(`/notebooks/${s.active}/conversations`);
      setHistory(threads);
    } catch {
      // The current conversation remains usable if the history refresh fails.
    }
  }
  async function startNewChat() {
    if (!s.active) return;
    try {
      const thread = await api<Conversation>(`/notebooks/${s.active}/conversations`, { method: "POST" });
      setHistory((items) => [{ ...thread, message_count: thread.message_count ?? 0 }, ...items.filter((item) => item.id !== thread.id)]);
      setConversationId(thread.id);
      setParams({ conversation: thread.id });
      setMessages([]);
      setQuestion("");
      setError("");
      setQueuedJob("");
      setHistoryOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Could not start a new chat.");
    }
  }
  function openChat(thread: Conversation) {
    setConversationId(thread.id);
    setParams({ conversation: thread.id });
    setMessages([]);
    setQuestion("");
    setError("");
    setQueuedJob("");
    setHistoryOpen(false);
  }
  async function deleteChat(thread: Conversation) {
    if (!window.confirm(`Delete “${thread.title}”? This cannot be undone.`)) return;
    try {
      await api(`/notebooks/${s.active}/conversations/${thread.id}`, { method: "DELETE" });
      const remaining = history.filter((item) => item.id !== thread.id);
      setHistory(remaining);
      if (thread.id === conversationId) {
        if (remaining[0]) openChat(remaining[0]);
        else await startNewChat();
      }
    } catch (e: any) {
      toast.error(e.message || "Could not delete this chat.");
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
      <div className="chat-toolbar">
        <select
          id="chat-notebook-picker"
          name="active-notebook"
          className="chat-notebook-picker"
          aria-label="Active notebook"
          value={s.active}
          onChange={(e) => s.set({ active: e.target.value })}
        >
          {s.notebooks.map((notebook) => (
            <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
          ))}
        </select>
        <details className="chat-source-selection">
          <summary>
            Study sources · {s.selectedSources === null ? "All ready" : `${s.selectedSources.length} selected`}
          </summary>
          <div className="chat-source-options">
            <button className="text-button" onClick={() => s.selectSources(null)}>Use all ready sources</button>
            {sources.map((source) => (
              <label key={source.id}>
                <input
                  id={`chat-source-${source.id}`}
                  name="selected-sources"
                  type="checkbox"
                  disabled={source.status !== "ready"}
                  checked={source.status === "ready" && (s.selectedSources === null || s.selectedSources.includes(source.id))}
                  onChange={(e) => {
                    const ids = s.selectedSources ?? sources.filter((item) => item.status === "ready").map((item) => item.id);
                    s.selectSources(e.target.checked ? [...ids, source.id] : ids.filter((id) => id !== source.id));
                  }}
                />
                {source.name}<small>{source.status}</small>
              </label>
            ))}
          </div>
        </details>
        <strong className="chat-toolbar-title">AI Assistant</strong>
        <div className="chat-toolbar-actions">
          <button className="secondary" onClick={() => setHistoryOpen(true)}>
            <Clock3 size={15} /> History
          </button>
          <button className="secondary" onClick={startNewChat}>
            <Plus size={15} /> New chat
          </button>
          <button className="secondary chat-reference-desktop" onClick={() => setReferences((value) => !value)} aria-expanded={references}>
            <PanelRight size={15} /> References
          </button>
          <button className="secondary chat-reference-mobile" onClick={() => setMobileReferencesOpen((open) => !open)} aria-expanded={mobileReferencesOpen}>
            <PanelRight size={15} /> References
          </button>
        </div>
      </div>
      {mobileReferencesOpen && (
        <div className="mobile-reference-content">
          <div className="mobile-reference-heading">
            <div><strong>Reference desk</strong><small>Documents in your active notebook</small></div>
            <button className="icon-button" aria-label="Close references" onClick={() => setMobileReferencesOpen(false)}><X size={18} /></button>
          </div>
          {sources.map((source) => (
            <button className="mobile-reference-source" key={source.id} onClick={() => navigate(`/sources?source=${encodeURIComponent(source.id)}`)}>
              <BookOpen size={16} /><span>{source.name}<small>{source.status}</small></span>
            </button>
          ))}
          {!sources.length && <p>No sources added yet.</p>}
          <button className="secondary" onClick={() => navigate("/sources")}>Manage sources</button>
        </div>
      )}
      <div className="assistant-ai-status"><AIAccess ai={ai} /></div>
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
              id="assistant-question"
              name="question"
              autoComplete="off"
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
      {historyOpen && (
        <div className="chat-history-backdrop" onClick={() => setHistoryOpen(false)}>
          <aside className="chat-history-drawer" role="dialog" aria-modal="true" aria-label="Chat history" onClick={(e) => e.stopPropagation()}>
            <div className="chat-history-heading">
              <div><span className="eyebrow">YOUR CONVERSATIONS</span><h2>Chat History</h2></div>
              <button className="icon-button" aria-label="Close chat history" onClick={() => setHistoryOpen(false)}><X size={18} /></button>
            </div>
            <button className="primary chat-history-new" onClick={startNewChat}><Plus size={16} /> New chat</button>
            {history.length ? (
              <div className="chat-history-list">
                {history.map((thread) => (
                  <div className={`chat-history-item ${thread.id === conversationId ? "active" : ""}`} key={thread.id}>
                    <button className="chat-history-open" onClick={() => openChat(thread)}>
                      <strong>{thread.title || "New chat"}</strong>
                      <small>{new Date(thread.updated_at || thread.created_at).toLocaleDateString()} · {thread.message_count} messages</small>
                    </button>
                    <button className="icon-button chat-history-delete" aria-label={`Delete ${thread.title || "chat"}`} onClick={() => deleteChat(thread)}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            ) : <p className="chat-history-empty">No saved conversations yet.</p>}
          </aside>
        </div>
      )}
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
