import { useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  FileText,
  Files,
  Upload,
  Plus,
  Search,
  X,
  BookOpen,
  AlignLeft,
  Download,
  Loader2,
  PanelRight,
  Pencil,
  Trash2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useStore, type Source } from "../../store";
import { api, json, sourceFile, waitForJob } from "../../api";

import ReviewerPanel from "./ReviewerPanel";

const PdfReader = lazy(() => import("./PdfReader"));

type Preview = {
  sections?: { label: string; text: string }[];
  unreadable_pages?: number[];
  ocr_pages?: number[];
  page_count?: number;
  text: string;
  chunks: { page?: number; section?: number; text: string }[];
  status: string;
};
export default function SourcesPage({
  onCreateNotebook,
}: {
  onCreateNotebook?: () => void;
}) {
  const s = useStore();
  const navigate = useNavigate();
  const sources = s.sources.filter((x) => x.notebook === s.active);
  const [selected, select] = useState("");
  const source = sources.find((x) => x.id === selected) || sources[0];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("document");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [reprocessing, setReprocessing] = useState(false);
  const [paste, setPaste] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [pdfPage, setPdfPage] = useState(1);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState("");
  const [remove, setRemove] = useState(false);
  const [showReviewer, setShowReviewer] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    select(params.get("source") || "");
    setPdfPage(Math.max(1, Number(params.get("page")) || 1));
    setQuery("");
  }, [s.active]);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const fileController = new AbortController();
    setUrl("");
    setPreview(null);
    setError("");
    setLoading(!!source);
    if (source) {
      api<Preview>(`/sources/${source.id}/preview`)
        .then((data) => {
          if (active) setPreview(data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      if (source.type === "pdf")
        sourceFile(source.id, fileController.signal)
          .then((blob) => {
            if (!active) return;
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          })
          .catch((e) => {
            if (active) setError(e.message);
          });
    }
    return () => {
      active = false;
      fileController.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source?.id, source?.status, loadAttempt]);
  const chooseFiles = () => {
    if (!s.active) {
      onCreateNotebook?.();
      return;
    }
    input.current?.click();
  };
  async function upload(files: File[]) {
    if (!s.active) {
      toast.info("Create a notebook to organize your source.");
      onCreateNotebook?.();
      return false;
    }
    if (uploading || !files.length) return;
    setUploading(true);
    const notebook = s.active;
    try {
      await useStore.getState().flush();
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024)
          throw new Error("Files must be 10 MB or smaller.");
        const form = new FormData();
        form.append("file", file);
        const result = await api(`/notebooks/${notebook}/sources`, {
          method: "POST",
          body: form,
        });
        await useStore.getState().refresh();
        if (result.job_id) await waitForJob(result.job_id);
        await useStore.getState().refresh();
        if (useStore.getState().active === notebook) select(result.source.id);
        toast.success(
          result.duplicate
            ? "This source is already saved."
            : `${file.name} is ready to read.`,
        );
      }
      return true;
    } catch (e: any) {
      toast.error(e.message);
      await useStore
        .getState()
        .refresh()
        .catch(() => {});
      return false;
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  async function saveText() {
    if (!title.trim() || !text.trim()) return;
    const success = await upload([
      new File([text], `${title.trim().replace(/\.txt$/i, "")}.txt`, {
        type: "text/plain",
      }),
    ]);
    if (success) {
      setPaste(false);
      setTitle("");
      setText("");
      setTab("text");
    }
  }
  const sections = preview?.sections || [];
  return (
    <section className="feature-screen sources-screen">
      <div className="feature-heading">
        <div>
          <span className="eyebrow">READ · ORGANIZE · UNDERSTAND</span>
          <h1>Your source studio</h1>
          <p>
            Keep the original close. Build understanding from your own material.
          </p>
        </div>
        {!s.active ? (
          <button className="primary" onClick={onCreateNotebook}>
            <Plus size={16} />
            Create a notebook
          </button>
        ) : (
          <select
            aria-label="Source notebook"
            value={s.active}
            onChange={(e) => s.set({ active: e.target.value })}
          >
            {s.notebooks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <input
        hidden
        ref={input}
        type="file"
        multiple
        accept=".pdf,.docx,.txt"
        onChange={(e) => upload(Array.from(e.target.files || []))}
      />
      <div className={`source-studio ${showReviewer ? "" : "reviewer-hidden"}`}>
        <aside className="source-library">
          <div className="studio-label">
            <Files size={17} />
            <b>Library</b>
            <span>{sources.length}</span>
          </div>
          <div
            className="source-add"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              upload(Array.from(e.dataTransfer.files));
            }}
          >
            <Upload size={26} />
            <b>
              {uploading ? "Processing material…" : "Drop your study material"}
            </b>
            <small>PDF, DOCX, TXT · up to 10 MB</small>
            <button
              className="primary"
              disabled={uploading}
              onClick={chooseFiles}
            >
              {uploading ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Plus size={15} />
              )}
              Upload files
            </button>
            <button
              className="text-button"
              disabled={uploading}
              onClick={() => (s.active ? setPaste(true) : onCreateNotebook?.())}
            >
              <AlignLeft size={15} />
              Paste text instead
            </button>
          </div>
          <label className="source-search">
            <Search size={15} />
            <input
              aria-label="Search sources"
              placeholder="Find a source…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="source-filters">
            {["all", "pdf", "txt"].map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : f === "txt" ? "Text" : "PDF"}
              </button>
            ))}
          </div>
          <div className="source-items">
            {sources
              .filter(
                (f) =>
                  (filter === "all" || f.type === filter) &&
                  f.name.toLowerCase().includes(query.toLowerCase()),
              )
              .map((f) => (
                <button
                  className={`source-item ${f.id === source?.id ? "selected" : ""}`}
                  key={f.id}
                  onClick={() => {
                    select(f.id);
                    setPdfPage(1);
                    setTab(f.type === "pdf" ? "document" : "text");
                  }}
                >
                  <span className={`file-icon ${f.type}`}>
                    <FileText size={19} />
                  </span>
                  <span>
                    <b>{f.name}</b>
                    <small>
                      {f.type.toUpperCase()} · {f.status || "ready"}
                    </small>
                  </span>
                </button>
              ))}
            {!sources.length && (
              <p className="source-empty-hint">
                Your materials will appear here after you add them.
              </p>
            )}
            {sources.length > 0 &&
              !sources.some(
                (f) =>
                  (filter === "all" || f.type === filter) &&
                  f.name.toLowerCase().includes(query.toLowerCase()),
              ) && <p className="source-empty-hint">No matching sources.</p>}
          </div>
        </aside>
        <div className="document-container">
          <div className="document-top">
            <div>
              <FileText size={18} />
              <b>{source?.name || "Document viewer"}</b>
            </div>
            <div>
              {source && (
                <>
                  <button
                    className="icon-button"
                    aria-label="Rename selected source"
                    onClick={() => {
                      setName(source.name);
                      setRename(true);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Delete selected source"
                    onClick={() => setRemove(true)}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
              <button
                className="icon-button"
                aria-label="Toggle reviewer panel"
                aria-expanded={showReviewer}
                onClick={() => setShowReviewer(!showReviewer)}
              >
                <PanelRight size={17} />
              </button>
            </div>
          </div>
          {source && (
            <nav className="source-study-actions" aria-label="Study this source">
              <span>Study this source:</span>
              {[["Chat", "/chat"], ["Notes", "/notes"], ["Flashcards", "/flashcards"], ["Quiz", "/quizzes"], ["Mind map", "/mindmaps"]].map(([label, path]) => (
                <button className="text-button" key={path} onClick={() => {
                  useStore.getState().selectSources([source.id]);
                  navigate(path);
                }}>{label}</button>
              ))}
            </nav>
          )}
          <div className="document-tabs">
            {source?.type === "pdf" && (
              <button
                className={tab === "document" ? "active" : ""}
                onClick={() => setTab("document")}
              >
                Original PDF
              </button>
            )}
            <button
              className={
                tab === "text" || source?.type !== "pdf" ? "active" : ""
              }
              onClick={() => setTab("text")}
            >
              Extracted text
            </button>
            {url && (
              <a href={url} download={source?.name}>
                <Download size={14} />
                Download
              </a>
            )}
          </div>
          {source ? (
            <>
              <div
                className={`extraction-state ${source.status === "ready" ? "ready" : ""}`}
                role="status"
              >
                {source.status === "ready"
                  ? preview?.page_count
                    ? `Text available on ${preview.page_count - (preview.unreadable_pages?.length || 0)} of ${preview.page_count} pages. ${preview.ocr_pages?.length ? `${preview.ocr_pages.length} pages read with local OCR. ` : ""}Check the original when studying.`
                    : "Text extracted · check the original when studying."
                  : source.status === "ocr"
                    ? `Reading scanned pages locally · page ${source.processing_page || "…"} of ${source.page_count || "…"}…`
                    : source.error ||
                      `Document ${source.status || "processing"}…`}
              </div>
              {(source.status === "failed" ||
                source.status === "needs_ocr") && (
                <div className="extraction-state" role="alert">
                  {source.error || `Document ${source.status || "processing"}…`}
                  <button
                    className="text-button"
                    disabled={reprocessing}
                    onClick={async () => {
                      setReprocessing(true);
                      try {
                        const result = await api(
                          `/sources/${source.id}/retry`,
                          { method: "POST" },
                        );
                        await useStore.getState().refresh();
                        await waitForJob(result.job_id);
                        await useStore.getState().refresh();
                        toast.success("Source retry started.");
                      } catch (e: any) {
                        toast.error(e.message);
                      } finally {
                        setReprocessing(false);
                      }
                    }}
                  >
                    {reprocessing ? "Retrying…" : "Retry source"}
                  </button>
                </div>
              )}
              {preview?.unreadable_pages?.length &&
                source.status !== "failed" &&
                source.status !== "needs_ocr" && (
                  <div className="extraction-state" role="alert">
                    No readable text on pages{" "}
                    {preview.unreadable_pages.join(", ")}. These pages may be
                    blank or need OCR. Compare the original before studying.
                    {source.status === "ready" && (
                      <button
                        className="text-button"
                        disabled={reprocessing}
                        onClick={async () => {
                          setReprocessing(true);
                          try {
                            const result = await api(
                              `/sources/${source.id}/reprocess`,
                              { method: "POST" },
                            );
                            await useStore.getState().refresh();
                            await waitForJob(result.job_id);
                            await useStore.getState().refresh();
                            toast.success("PDF text updated.");
                          } catch (e: any) {
                            toast.error(e.message);
                          } finally {
                            setReprocessing(false);
                          }
                        }}
                      >
                        {reprocessing
                          ? "Reading scanned pages…"
                          : "Read scanned pages"}
                      </button>
                    )}
                  </div>
                )}
              {error && (
                <p className="field-error" role="alert">
                  {error}
                  {source.type === "pdf" && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setTab("document");
                        setLoadAttempt((n) => n + 1);
                      }}
                    >
                      Retry original PDF
                    </button>
                  )}
                </p>
              )}
              {loading ? (
                <div className="studio-empty">
                  <Loader2 className="spin" />
                  <p>Opening your material…</p>
                </div>
              ) : tab === "document" && source.type === "pdf" && url ? (
                <Suspense
                  fallback={
                    <div className="studio-empty">
                      <Loader2 className="spin" />
                      <p>Loading PDF reader…</p>
                    </div>
                  }
                >
                  <PdfReader
                    url={url}
                    name={source.name}
                    initialPage={pdfPage}
                  />
                </Suspense>
              ) : tab === "document" &&
                source.type === "pdf" &&
                !url &&
                !error ? (
                <div className="studio-empty">
                  <Loader2 className="spin" />
                  <p>Loading original PDF…</p>
                </div>
              ) : (
                <article className="extracted-document">
                  {preview?.text ? (
                    <>
                      <span className="eyebrow">
                        EXTRACTED SOURCE ·{" "}
                        {preview.text
                          .trim()
                          .split(/\s+/)
                          .length.toLocaleString()}{" "}
                        WORDS
                      </span>
                      <h2>{source.name}</h2>
                      <p className="extraction-note">
                        Text is shown in reading order. PDF layouts and tables
                        may need comparison with the original.
                      </p>
                      {sections.length > 0 ? (
                        sections.map(({ label, text }) => (
                          <section key={label}>
                            <h3>{label}</h3>
                            <p>
                              {text ||
                                "No readable text on this page. Check the original PDF."}
                            </p>
                          </section>
                        ))
                      ) : (
                        <p>{preview.text}</p>
                      )}
                    </>
                  ) : (
                    <div className="studio-empty">
                      <AlignLeft size={32} />
                      <h2>No readable text yet</h2>
                      <p>
                        {source.status === "needs_ocr"
                          ? "This scanned PDF needs OCR. You can paste its text as a new source."
                          : "Text will appear after successful extraction."}
                      </p>
                    </div>
                  )}
                </article>
              )}
            </>
          ) : (
            <div className="studio-empty">
              <div className="empty-document-art">
                <BookOpen size={44} />
              </div>
              <span className="eyebrow">YOUR MATERIAL, IN FOCUS</span>
              <h2>A place for every page.</h2>
              <p>
                Upload a PDF to read it here, or paste your study notes to get
                started.
              </p>
              <button className="secondary" onClick={chooseFiles}>
                Add your first source
              </button>
            </div>
          )}
        </div>
        {showReviewer && (
          <ReviewerPanel
            source={source}
            onCitation={(c) => {
              select(c.source_id);
              setPdfPage(c.page || 1);
              setTab(
                s.sources.find((x) => x.id === c.source_id)?.type === "pdf"
                  ? "document"
                  : "text",
              );
            }}
          />
        )}
      </div>
      {paste && (
        <div className="modal-backdrop">
          <form
            className="modal paste-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paste-title"
            onSubmit={(e) => {
              e.preventDefault();
              saveText();
            }}
          >
            <button
              type="button"
              className="modal-close icon-button"
              aria-label="Close paste text"
              disabled={uploading}
              onClick={() => setPaste(false)}
            >
              <X />
            </button>
            <span className="eyebrow">ADD A TEXT SOURCE</span>
            <h2 id="paste-title">Bring your words along.</h2>
            <p>Paste lecture notes, definitions, or a chapter excerpt.</p>
            <label>
              Source title
              <input
                autoFocus
                maxLength={150}
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. JavaScript basics"
              />
            </label>
            <label>
              Study material
              <textarea
                required
                maxLength={2000000}
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste your material here…"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={uploading}
                onClick={() => setPaste(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={uploading || !title.trim() || !text.trim()}
              >
                {uploading ? "Saving…" : "Save text source"}
              </button>
            </div>
          </form>
        </div>
      )}
      {rename && source && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Rename source"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`/sources/${source.id}`, {
                  method: "PATCH",
                  body: json({ name: name.trim() }),
                });
                await s.refresh();
                setRename(false);
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            <h2>Rename source</h2>
            <input
              aria-label="Source name"
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setRename(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={!name.trim()}>
                Save name
              </button>
            </div>
          </form>
        </div>
      )}
      {remove && source && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Remove source"
          >
            <h2>Remove {source.name}?</h2>
            <p>
              The source and its original file will be removed from this
              notebook. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setRemove(false)}>
                Keep source
              </button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await api(`/sources/${source.id}`, { method: "DELETE" });
                    await s.refresh();
                    setRemove(false);
                  } catch (e: any) {
                    toast.error(e.message);
                  }
                }}
              >
                Remove source
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
