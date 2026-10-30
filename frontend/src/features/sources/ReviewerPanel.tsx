import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Sparkles, Save, FileText } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../api";
import { type Source, useStore } from "../../store";
import { useArtifacts } from "../study/StudyShared";
import { AIAccess } from "../ai/AIAccess";
export type SourceCitation = {
  source_id: string;
  page?: number;
  section?: number;
  quote: string;
};
export function parsePages(value: string): number[] {
  if (!value.trim()) throw new Error("Enter a page range, for example 1-5, 8.");
  const pages = new Set<number>();
  for (const part of value
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match)
      throw new Error("Use page numbers or ranges, for example 1-5, 8.");
    const from = Number(match[1]),
      to = Number(match[2] || match[1]);
    if (from < 1 || to < from || to > 1000)
      throw new Error("Choose ascending page ranges between 1 and 1000.");
    for (let n = from; n <= to; n++) pages.add(n);
  }
  return [...pages].sort((a, b) => a - b);
}
export default function ReviewerPanel({
  source,
  onCitation,
}: {
  source?: Source;
  onCitation: (citation: SourceCitation) => void;
}) {
  const a = useArtifacts("guide");
  const navigate = useNavigate();
  const [coverage, setCoverage] = useState("whole");
  const [range, setRange] = useState("");
  const [style, setStyle] = useState("detailed");
  const [saving, setSaving] = useState(false);
  const s = useStore();
  const reviewer = a.artifact;
  const citation = (c: SourceCitation, i: number) => (
    <button
      key={i}
      className="reviewer-citation"
      title={c.quote}
      onClick={() => onCitation(c)}
    >
      <FileText size={12} />
      {s.sources.find((x) => x.id === c.source_id)?.name || "Source"} ·{" "}
      {c.page ? `p. ${c.page}` : `section ${c.section || 1}`}
    </button>
  );
  async function generate() {
    if (!source) return;
    try {
      const pages =
        coverage === "pages" && source.type === "pdf"
          ? parsePages(range)
          : null;
      await a.generate({ source_ids: [source.id], pages, style });
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  return (
    <aside className="reviewer-panel reviewer-live">
      <span className="reviewer-badge">
        <Sparkles size={13} />
        REVIEWER STUDIO
      </span>
      <h2>From reading to remembering.</h2>
      <p>
        Build a reviewer from the selected PDF or text. Every generated section
        includes checked source quotes.
      </p>
      <AIAccess ai={a.ai} />
      <label>
        Coverage
        <select value={coverage} onChange={(e) => setCoverage(e.target.value)}>
          <option value="whole">Whole selected source</option>
          <option value="pages" disabled={source?.type !== "pdf"}>
            Selected PDF pages
          </option>
        </select>
      </label>
      {coverage === "pages" && source?.type === "pdf" && (
        <label>
          Page range
          <input
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder="e.g. 1-5, 8"
          />
        </label>
      )}
      <label>
        Reviewer style
        <select value={style} onChange={(e) => setStyle(e.target.value)}>
          <option value="detailed">Detailed study guide</option>
          <option value="concise">Quick revision</option>
          <option value="questions">Questions & answers</option>
        </select>
      </label>
      <button
        className="primary"
        disabled={!a.ai.ready || !source || source.status !== "ready" || a.busy}
        onClick={generate}
      >
        <Sparkles size={16} />
        {a.busy ? "Creating reviewer…" : "Create reviewer"}
      </button>
      {a.progress && (
        <p role="status" className="generation-progress">
          {a.progress}
        </p>
      )}
      {a.error && (
        <p role="alert" className="field-error">
          {a.error}
        </p>
      )}
      {a.items.length > 0 && (
        <label>
          Saved reviewers
          <select
            value={a.active}
            onChange={(e) => a.setActive(e.target.value)}
          >
            {a.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title || "Study reviewer"} ·{" "}
                {new Date(r.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
      )}
      {reviewer ? (
        <article className="reviewer-result">
          <span className="eyebrow">SAVED REVIEWER</span>
          <h3>{reviewer.title}</h3>
          <p>{reviewer.overview}</p>
          {reviewer.warnings?.map((warning: string, i: number) => (
            <p className="reviewer-warning" key={i}>
              {warning}
            </p>
          ))}
          {reviewer.sections?.map((section: any, i: number) => (
            <section key={i}>
              <h4>{section.heading}</h4>
              <p>{section.content}</p>
              <div className="reviewer-citations">
                {section.citations.map(citation)}
              </div>
            </section>
          ))}
          {reviewer.practice_questions?.length > 0 && (
            <section>
              <h4>Practice questions</h4>
              {reviewer.practice_questions.map((q: any, i: number) => (
                <details key={i}>
                  <summary>{q.question}</summary>
                  <p>{q.answer}</p>
                  <div className="reviewer-citations">
                    {q.citations.map(citation)}
                  </div>
                </details>
              ))}
            </section>
          )}
          <button
            className="secondary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                const note = await api(`/artifacts/${reviewer.id}/save-note`, {
                  method: "POST",
                });
                await useStore.getState().refresh();
                toast.success("Reviewer saved to Notes.");
                navigate(`/notes?note=${note.id}`);
              } catch (e: any) {
                toast.error(e.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save size={14} />
            {saving ? "Saving…" : "Save reviewer to Notes"}
          </button>
        </article>
      ) : (
        <div className="reviewer-outline">
          <span className="eyebrow">YOUR REVIEWER WILL INCLUDE</span>
          {[
            "Overview & learning goals",
            "Key concepts & definitions",
            "Source-supported examples",
            "Practice questions",
            "Clickable page references",
          ].map((text, i) => (
            <div key={text}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              {text}
            </div>
          ))}
        </div>
      )}
      <small className="muted">
        AI can make mistakes. Compare explanations with the original material.
      </small>
    </aside>
  );
}
