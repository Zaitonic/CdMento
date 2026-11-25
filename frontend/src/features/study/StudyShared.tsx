import { useState, useEffect, useRef } from "react";
import { FileText, X, Sparkles } from "lucide-react";
import { useStore } from "../../lib/store";
import { api, json, waitForJob } from "../../lib/api";
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

type ArtifactCache = {
  items: any[];
  activeBySource: Record<string, string>;
};

const artifactCache = new Map<string, ArtifactCache>();

function reviewerStorageKey(key: string) {
  return `cdmento-reviewer:${key}`;
}

function readRememberedReviewer(key: string) {
  try {
    return localStorage.getItem(reviewerStorageKey(key)) || "";
  } catch {
    return "";
  }
}

function rememberReviewer(key: string, id: string) {
  try {
    if (id) localStorage.setItem(reviewerStorageKey(key), id);
    else localStorage.removeItem(reviewerStorageKey(key));
  } catch {
    // The cache still works for this session when storage is unavailable.
  }
}

export function useArtifacts(kind: string, sourceId?: string) {
  const ai = useAI();
  const [topic, setTopic] = useState("");
  const [itemsInput, setItemsInput] = useState("8");
  const [difficulty, setDifficulty] = useState("medium");
  const [progress, setProgress] = useState("");
  const notebook = useStore((s) => s.active);
  const owner = useStore((s) => s.owner);
  const cacheKey = `${owner}:${notebook}:${kind}`;
  const activeKey = sourceId ? `${cacheKey}:source:${sourceId}` : cacheKey;
  const cached = artifactCache.get(cacheKey);
  const [items, setItems] = useState<any[]>(cached?.items || []);
  const [active, setActiveState] = useState(
    () => readRememberedReviewer(activeKey) || "",
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(true);
  const mounted = useRef(true);
  const lastRequest = useRef<Record<string, unknown>>({});
  const hasGenerated = useRef(false);
  const visibleItems = sourceId
    ? items.filter(
        (item) =>
          Array.isArray(item.source_ids) && item.source_ids.includes(sourceId),
      )
    : items;

  const setActive = (id: string) => {
    setActiveState(id);
    const entry = artifactCache.get(cacheKey) || {
      items: [],
      activeBySource: {},
    };
    entry.activeBySource[activeKey] = id;
    artifactCache.set(cacheKey, entry);
    rememberReviewer(activeKey, id);
  };

  const reload = async () => {
    if (!notebook) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api(
        `/notebooks/${notebook}/artifacts?kind=${kind}`,
        {},
        15_000,
      );
      if (!mounted.current) return;
      setItems(result);
      const entry = artifactCache.get(cacheKey) || {
        items: [],
        activeBySource: {},
      };
      entry.items = result;
      artifactCache.set(cacheKey, entry);
    } catch (e: any) {
      if (!mounted.current) return;
      if (e?.status === 404) {
        // A deleted or stale notebook is a workspace-sync issue, not a
        // reviewer failure. Refresh instead of showing a scary panel error.
        await useStore
          .getState()
          .refresh()
          .catch(() => {});
      } else {
        setError(e?.message || "Could not load your saved study material.");
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const entry = artifactCache.get(cacheKey);
    setItems(entry?.items || []);
    setError("");
    setBusy(false);
    if (!notebook) {
      setLoading(false);
      return;
    }
    setLoading(!entry?.items.length);
    reload().catch((e) => {
      if (mounted.current) setError(e.message);
    });
    api(`/notebooks/${notebook}/jobs`, {}, 15_000)
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
  }, [notebook, kind, owner]);

  useEffect(() => {
    setActiveState((current) => {
      if (visibleItems.some((item) => item.id === current)) return current;
      const remembered = readRememberedReviewer(activeKey);
      if (visibleItems.some((item) => item.id === remembered)) return remembered;
      return visibleItems.at(-1)?.id || "";
    });
  }, [items, sourceId, activeKey]);

  const generate = async (extra: Record<string, unknown> = {}) => {
    if (busy || !ai.ready || !notebook) return;
    const count = Math.min(30, Math.max(1, Number(itemsInput) || 1));
    setItemsInput(String(count));
    lastRequest.current = extra;
    hasGenerated.current = true;
    setBusy(true);
    setError("");
    setProgress("Preparing your material…");
    try {
      await useStore.getState().flush();
      const response = await api(
        `/notebooks/${notebook}/generations`,
        {
          method: "POST",
          body: json({
            kind,
            topic,
            count,
            difficulty,
            source_ids: useStore.getState().selectedSources,
            ...extra,
          }),
        },
        30_000,
      );
      if (response.job_id)
        await waitForJob(
          response.job_id,
          (job) => {
            if (mounted.current)
              setProgress(
                job.status === "waiting"
                  ? `${job.error || "AI temporarily unavailable."} Retrying automatically after ${new Date(job.retry_at * 1000).toLocaleTimeString()}`
                  : job.progress
                    ? `Processed ${job.progress} document parts…`
                    : "Creating your study material…",
              );
          },
          {
            timeoutMs: 6 * 60 * 1000,
            // Vercel executes queued jobs while serving the polling request.
            // Larger generations can legitimately take longer than the old
            // 20-second per-poll timeout, even when the job will complete.
            pollTimeoutMs: count > 10 ? 90_000 : 60_000,
          },
        );
      if (mounted.current) {
        await reload();
        setActive(response.artifact_id);
        setSettingsOpen(false);
        setProgress("");
      }
      return response.artifact_id as string;
    } catch (e: any) {
      if (mounted.current) {
        setProgress("");
        if (e?.status !== 499 && e?.name !== "AbortError")
          setError(e?.message || "Generation failed. Retry when ready.");
      }
      return undefined;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const retry = () => {
    if (hasGenerated.current) return generate(lastRequest.current);
    return reload();
  };

  const controls = (
    <>
      <AIAccess ai={ai} />
      <button className="generation-mobile-toggle" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>{settingsOpen ? "Hide generator" : "Generate or adjust"}</button>
      <div className={`generation-mobile-settings ${settingsOpen ? "open" : "closed"}`}>
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
            value={itemsInput}
            onChange={(e) => setItemsInput(e.target.value)}
            onBlur={() => {
              const value = Math.min(30, Math.max(1, Number(itemsInput) || 1));
              setItemsInput(String(value));
            }}
          />
          <small>1–30 items</small>
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
      <div className="generation-presets" aria-label="Item count presets">
        {[5, 10, 15, 20, 30].map((value) => (
          <button
            key={value}
            type="button"
            className={itemsInput === String(value) ? "active" : ""}
            onClick={() => setItemsInput(String(value))}
          >
            {value}
          </button>
        ))}
      </div>
      </div>
      {progress && (
        <p className="generation-progress" role="status">
          {progress}
        </p>
      )}
      {error && (
        <div className="connection-banner" role="alert">
          <span>{error}</span>
          <button onClick={retry}>Retry</button>
        </div>
      )}
      {visibleItems.length > 0 && (
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
            {visibleItems.map((a, i) => (
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
    items: visibleItems,
    active,
    setActive,
    artifact: visibleItems.find((a) => a.id === active),
    reload,
    retry,
    retryLoad: reload,
    controls,
    busy,
    loading,
  };
}
