import { useSearchParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Plus, NotebookPen, Trash2, Check, BookOpen } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useStore } from "../../lib/store";

type OutlineHeading = { level: number; text: string };

function hasDocumentText(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  if (value.type === "text") return Boolean(value.text?.trim());
  return Array.isArray(value.content) && value.content.some(hasDocumentText);
}

function isTipTapDocument(value: any): boolean {
  if (!value || value.type !== "doc" || !Array.isArray(value.content)) {
    return false;
  }
  const valid = new Set([
    "doc",
    "paragraph",
    "heading",
    "bullet_list",
    "ordered_list",
    "list_item",
    "blockquote",
    "hard_break",
    "text",
  ]);
  const walk = (node: any): boolean => {
    if (!node || typeof node !== "object" || !valid.has(node.type)) return false;
    if (node.type === "text") return typeof node.text === "string";
    if (node.type === "heading") {
      const level = node.attrs?.level;
      if (![1, 2, 3].includes(level)) return false;
    }
    return !node.content || (Array.isArray(node.content) && node.content.every(walk));
  };
  return value.content.every(walk);
}

function editorContent(note: { document?: object | null; content: string } | undefined) {
  const document = note?.document;
  if (isTipTapDocument(document) && hasDocumentText(document)) return document;
  return note?.content?.trim() || "";
}

function extractHeadings(json: any): OutlineHeading[] {
  if (!json || json.type !== "doc") return [];
  const headings: OutlineHeading[] = [];
  function walk(node: any) {
    if (
      node.type === "heading" &&
      Number.isInteger(node.attrs?.level) &&
      node.attrs.level >= 1 &&
      node.attrs.level <= 3
    ) {
      const text = node.content
        ?.filter((child: any) => child.type === "text")
        .map((child: any) => child.text)
        .join("")
        .trim();
      if (text) headings.push({ level: node.attrs.level, text });
    }
    node.content?.forEach(walk);
  }
  walk(json);
  return headings;
}

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
  // Do not temporarily fall back to the first note while a deep-linked note
  // is still loading. That fallback can mount an empty editor and autosave it
  // over the requested note before the workspace hydration finishes.
  const note = requestedNote
    ? notes.find((n) => n.id === requestedNote)
    : notes.find((n) => n.id === id) || notes[0];
  const lastDocument = useRef("");
  const hydrating = useRef(false);
  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: editorContent(note) as any,
      onUpdate: ({ editor }) => {
        if (hydrating.current) return;
        lastDocument.current = JSON.stringify(editor.getJSON());
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
  useEffect(() => {
    if (!editor || !note) return;
    const content = editorContent(note);
    const signature = JSON.stringify(content);
    if (signature === lastDocument.current) return;
    hydrating.current = true;
    try {
      editor.commands.setContent(content as any, { emitUpdate: false });
    } catch {
      // Legacy notes may contain malformed ProseMirror JSON. Falling back to
      // their plain-text payload keeps the note editable instead of crashing
      // the route on a direct reload.
      editor.commands.setContent(note.content || "", { emitUpdate: false });
    }
    lastDocument.current = JSON.stringify(editor.getJSON());
    hydrating.current = false;
  }, [editor, note?.id, note?.document, note?.content]);
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
                {extractHeadings(editor?.getJSON()).map((h, i) => (
                  <div key={i} className={`outline-item h${h.level}`}>
                    {h.text}
                  </div>
                ))}
                {!extractHeadings(editor?.getJSON()).length && (
                  <p className="empty-outline">Add headings (H2) to build an outline.</p>
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
