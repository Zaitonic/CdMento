import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen,
  ArrowUpRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  LayoutGrid,
  List,
  BookOpen,
} from "lucide-react";
import { useStore } from "../../store";

type Props = {
  search: string;
  allowViewSwitch?: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};
export default function NotebookLibrary({
  search,
  allowViewSwitch,
  onRename,
  onDelete,
}: Props) {
  const s = useStore();
  const navigate = useNavigate();
  const [view, setView] = useState("grid");
  const books = s.notebooks.filter((n) =>
    n.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      {allowViewSwitch && (
        <div className="library-toolbar">
          <span>{books.length} notebooks · your subjects, together</span>
          <div>
            <button
              className={view === "grid" ? "active" : ""}
              onClick={() => setView("grid")}
              aria-label="Grid view"
              aria-pressed={view === "grid"}
            >
              <LayoutGrid size={17} />
            </button>
            <button
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
              aria-label="List view"
              aria-pressed={view === "list"}
            >
              <List size={17} />
            </button>
          </div>
        </div>
      )}
      {!books.length ? (
        <div className="empty">
          <BookOpen size={32} />
          <h2>
            {s.notebooks.length
              ? "No matching notebooks"
              : "Make room for a new subject."}
          </h2>
          <p>
            {s.notebooks.length
              ? "Try a different search."
              : "Create your first notebook to collect sources, notes, and ideas."}
          </p>
        </div>
      ) : (
        <div
          className={`notebook-grid ${allowViewSwitch && view === "list" ? "notebook-list-view" : ""}`}
        >
          {books.map((n, i) => (
            <article className="notebook-card" key={n.id}>
              <button
                className="notebook-open"
                onClick={() => {
                  s.set({ active: n.id });
                  navigate("/sources");
                }}
              >
                <span className={`folder ${n.color}`}>
                  <FolderOpen size={27} />
                </span>
                <span className="notebook-category">
                  PERSONAL NOTEBOOK{" "}
                  <span>{String(i + 1).padStart(2, "0")}</span>
                </span>
                <h3>{n.name}</h3>
                <p>
                  {s.sources.filter((x) => x.notebook === n.id).length} sources{" "}
                  <span>·</span>{" "}
                  {s.notes.filter((x) => x.notebook === n.id).length} notes
                </p>
                <span className="open-notebook">
                  Open notebook <ArrowUpRight size={16} />
                </span>
              </button>
              <details className="card-menu">
                <summary aria-label={`Options for ${n.name}`}>
                  <MoreHorizontal size={19} />
                </summary>
                <div>
                  <button onClick={() => onRename(n.id, n.name)}>
                    <Pencil size={14} />
                    Rename
                  </button>
                  <button onClick={() => onDelete(n.id)}>
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
