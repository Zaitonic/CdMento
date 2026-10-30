import { useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Plus, NotebookPen, Trash2, Check, BookOpen } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useStore } from "../../store";
function PageTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="page-title">
      <span className="eyebrow">PERSONAL NOTES / WRITING DESK</span>
      <h1>{title}</h1>
      <p>{desc}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <BookOpen size={30} />
      <p>{text}</p>
    </div>
  );
}
export default function Notes() {
  const s = useStore();
  const notes = s.notes.filter((n) => n.notebook === s.active);
  const [params] = useSearchParams();
  const requestedNote = params.get("note");
  const [id, setId] = useState(requestedNote || notes[0]?.id || "");
  useEffect(() => { if (requestedNote) setId(requestedNote); }, [requestedNote]);
  const note = notes.find((n) => n.id === id) || notes[0];
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: (note?.document ?? note?.content ?? "") as any,
      onUpdate: ({ editor }) => {
        const state = useStore.getState();
        state.set({
          notes: state.notes.map((n) =>
            n.id === note?.id
              ? { ...n, content: editor.getHTML(), document: editor.getJSON() }
              : n,
          ),
        });
      },
    },
    [note?.id],
  );
  return (
    <section className="feature-screen notes-screen">
      <PageTitle
        title="A space for your thoughts"
        desc="Write it down. Make it yours."
      />
      <div className="notes-layout">
        <div className="notes-list">
          <button
            className="primary"
            onClick={() => {
              const newId = crypto.randomUUID();
              s.set({
                notes: [
                  ...s.notes,
                  {
                    id: newId,
                    notebook: s.active,
                    title: "Untitled note",
                    content: "",
                  },
                ],
              });
              setId(newId);
            }}
          >
            <Plus size={17} />
            New note
          </button>
          {notes.map((n) => (
            <button
              className={note?.id === n.id ? "active" : ""}
              key={n.id}
              onClick={() => setId(n.id)}
            >
              <NotebookPen size={17} />
              {n.title}
            </button>
          ))}
        </div>
        {note ? (
          <div className="note-editor">
            <div className="note-header">
              <input
                aria-label="Note title"
                value={note.title}
                onChange={(e) =>
                  s.set({
                    notes: s.notes.map((n) =>
                      n.id === note.id ? { ...n, title: e.target.value } : n,
                    ),
                  })
                }
              />
              <button
                className="icon-button"
                aria-label="Delete note"
                onClick={() =>
                  s.set({ notes: s.notes.filter((n) => n.id !== note.id) })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="editor-toolbar">
              <button
                onClick={() => editor?.chain().focus().toggleBold().run()}
              >
                <b>B</b>
              </button>
              <button
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              >
                <i>I</i>
              </button>
              <button
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                H2
              </button>
              <button
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                List
              </button>
              <span>
                <Check size={12} />
                {s.sync}
              </span>
            </div>
            <div className="writing-workspace">
              <div className="writing-page">
                <span className="eyebrow">NOTEBOOK / PERSONAL NOTES</span>
                <EditorContent editor={editor} />
                <div className="writing-footer">
                  {editor?.getText().trim().split(/\s+/).filter(Boolean)
                    .length || 0}{" "}
                  words · Automatic saving enabled
                </div>
              </div>
              <aside className="note-outline">
                <span className="eyebrow">ON THIS PAGE</span>
                {(
                  editor?.getText().split("\n").filter(Boolean).slice(0, 8) ||
                  []
                ).map((line, i) => (
                  <p key={i}>{line.slice(0, 65)}</p>
                ))}
                {!editor?.getText() && (
                  <p>Add headings and ideas to shape your note.</p>
                )}
              </aside>
            </div>
          </div>
        ) : (
          <Empty text="Create your first note to get started." />
        )}
      </div>
    </section>
  );
}
