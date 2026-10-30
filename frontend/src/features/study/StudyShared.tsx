import { useState, useEffect, useRef } from "react";
import { FileText, X, Sparkles } from "lucide-react";
import { useStore } from "../../store";
import { api, json, waitForJob } from "../../api";
import { useAI, AIAccess } from "../ai/AIAccess";

export function Title({
  title,
  desc,
  label,
}: {
  title: string;
  desc: string;
  label: string;
}) {
  return (
    <div className="page-title">
      <span className="eyebrow">{label}</span>
      <h1>{title}</h1>
      <p>{desc}</p>
    </div>
  );
}
export function Evidence({ ids }: { ids: string[] }) {
  const sources = useStore((s) => s.sources);
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <>
      <div className="citation-list">
        {ids.map((id) => {
          const source = sources.find((s) => s.id === id);
          return source ? (
            <button key={id} onClick={() => setPreview(id)}>
              <FileText size={12} />
              {source.name}
            </button>
          ) : (
            <span key={id}>Source no longer available</span>
          );
        })}
      </div>
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div
            className="modal preview"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Source evidence"
          >
            <button
              className="modal-close icon-button"
              aria-label="Close evidence"
              onClick={() => setPreview(null)}
            >
              <X />
            </button>
            <h2>{sources.find((s) => s.id === preview)?.name}</h2>
            <pre>{sources.find((s) => s.id === preview)?.text}</pre>
          </div>
        </div>
      )}
    </>
  );
}

export function useArtifacts(kind: string) {
  const ai = useAI();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] = useState("medium");
  const [progress, setProgress] = useState("");
  const notebook = useStore((s) => s.active);
  const [items, setItems] = useState<any[]>([]);
  const [active, setActive] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const reload = async () => {
    if (!notebook) return;
    const result = await api(`/notebooks/${notebook}/artifacts?kind=${kind}`);
    if (mounted.current) {
      setItems(result);
      setActive((old) =>
        result.some((a: any) => a.id === old) ? old : result.at(-1)?.id || "",
      );
    }
  };
  useEffect(() => {
    mounted.current = true;
    setItems([]);
    setActive("");
    setError("");
    if (!notebook) return;
    reload().catch((e) => setError(e.message));
    api(`/notebooks/${notebook}/jobs`)
      .then(async (jobs) => {
        const job = jobs.find(
          (j: any) =>
            j.kind === "generate" &&
            j.request?.kind === kind &&
            ["queued", "processing", "waiting"].includes(j.status),
        );
        if (job) {
          setBusy(true);
          try {
            await waitForJob(job.id);
            if (mounted.current) await reload();
          } catch (e: any) {
            if (mounted.current) setError(e.message);
          } finally {
            if (mounted.current) setBusy(false);
          }
        }
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, [notebook, kind]);
  const generate = async (extra: Record<string, unknown> = {}) => {
    if (busy || !ai.ready) return;
    setBusy(true);
    setError("");
    setProgress("Preparing your material…");
    try {
      await useStore.getState().flush();
      const response = await api(`/notebooks/${notebook}/generations`, {
        method: "POST",
        body: json({
          kind,
          topic,
          count,
          difficulty,
          source_ids: useStore.getState().selectedSources,
          ...extra,
        }),
      });
      if (response.job_id)
        await waitForJob(response.job_id, (job) => {
          if (mounted.current)
            setProgress(
              job.status === "waiting"
                ? `${job.error || "AI temporarily unavailable."} Retrying automatically after ${new Date(job.retry_at * 1000).toLocaleTimeString()}`
                : job.progress
                  ? `Processed ${job.progress} document parts…`
                  : "Creating your study material…",
            );
        });
      if (mounted.current) {
        await reload();
        setActive(response.artifact_id);
        setProgress("");
      }
      return response.artifact_id as string;
    } catch (e: any) {
      if (mounted.current) setError(e.message);
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const controls = (
    <>
      <AIAccess ai={ai} />
      <div className="generation-toolbar">
        <label>
          Topic
          <input
            value={topic}
            maxLength={500}
            placeholder="Key concepts"
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>
        <label>
          Items
          <input
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(e) =>
              setCount(Math.min(30, Math.max(1, Number(e.target.value))))
            }
          />
        </label>
        <label>
          Difficulty
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || !ai.ready}
          onClick={() => generate()}
        >
          <Sparkles size={16} />
          {busy ? "Creating…" : "Generate with AI"}
        </button>
      </div>
      {progress && (
        <p className="generation-progress" role="status">
          {progress}
        </p>
      )}
      {error && (
        <div className="connection-banner" role="alert">
          {error}
        </div>
      )}
      {items.length > 0 && (
        <label className="artifact-picker">
          Saved{" "}
          {kind === "quiz"
            ? "quizzes"
            : kind === "flashcards"
              ? "decks"
              : "maps"}
          <select
            aria-label="Saved study material"
            value={active}
            onChange={(e) => setActive(e.target.value)}
          >
            {items.map((a, i) => (
              <option key={a.id} value={a.id}>
                {new Date(a.created_at).toLocaleDateString()} · Set {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
  return {
    ai,
    generate,
    error,
    progress,
    items,
    active,
    setActive,
    artifact: items.find((a) => a.id === active),
    reload,
    controls,
    busy,
  };
}
