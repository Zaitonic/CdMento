import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Upload,
  Plus,
  GraduationCap,
  Check,
  Sparkles,
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  FolderOpen,
  Files,
  NotebookPen,
  Layers,
  ClipboardList,
  Network,
} from "lucide-react";
import { useStore } from "../../store";
import NotebookLibrary from "../notebooks/NotebookLibrary";
const tools = [
  {
    path: "/notes",
    name: "Notes",
    desc: "Make room for your ideas.",
    icon: NotebookPen,
    color: "purple",
  },
  {
    path: "/flashcards",
    name: "Flashcards",
    desc: "A little practice. A lot retained.",
    icon: Layers,
    color: "green",
  },
  {
    path: "/quizzes",
    name: "Quizzes",
    desc: "See what you really know.",
    icon: ClipboardList,
    color: "orange",
  },
  {
    path: "/mindmaps",
    name: "Mind Maps",
    desc: "Connect the dots.",
    icon: Network,
    color: "pink",
  },
];
type Props = {
  chooseFiles: () => void;
  openModal: (kind: string, id?: string, name?: string) => void;
  onDelete: (id: string) => void;
};
export default function HomePage({ chooseFiles, openModal, onDelete }: Props) {
  const s = useStore();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const openQuestion = (text: string) => navigate(`/chat?question=${encodeURIComponent(text.trim())}`);
  return (
    <motion.div
      className="home-screen"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="page-eyebrow">
        <span className="little-dot green" /> A LITTLE FOCUS. A WORLD OF
        POSSIBILITIES.
      </div>
      <section className="hero">
        <div>
          <p className="greeting">Your next lightbulb moment starts here.</p>
          <h1>
            Less overwhelm.
            <br />
            <span>More understanding.</span>
          </h1>
          <p className="hero-description">
            Your notes, sources, and ideas. One calm place to
            <br className="desktop-break" /> bring it all together — and make it
            stick.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={chooseFiles}>
              <Upload size={17} />
              Upload files
            </button>
            <button className="secondary" onClick={() => openModal("notebook")}>
              <Plus size={18} />
              New notebook
            </button>
          </div>
          <span className="file-hint">
            PDF, DOCX, or TXT <span>·</span> Up to 10 MB per file
          </span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="spark spark-one">✦</span>
          <span className="spark spark-two">✧</span>
          <span className="spark spark-three">+</span>
          <div className="book book-back" />
          <div className="book book-mid" />
          <div className="book book-front">
            <span />
            <i />
            <i />
            <i />
            <div className="book-badge">
              <GraduationCap size={27} />
            </div>
          </div>
          <span className="floating-label">
            <Check size={13} /> One idea at a time
          </span>
        </div>
      </section>
      <div className="dashboard-metrics">
        <div>
          <FolderOpen size={20} />
          <b>{s.notebooks.length}</b>
          <span>Notebooks</span>
        </div>
        <div>
          <Files size={20} />
          <b>{s.sources.length}</b>
          <span>Study sources</span>
        </div>
        <div>
          <NotebookPen size={20} />
          <b>{s.notes.length}</b>
          <span>Personal notes</span>
        </div>
      </div>
      <form className="ask-home" onSubmit={(event) => { event.preventDefault(); openQuestion(question); }}>
        <span className="ask-symbol">
          <Sparkles size={20} />
        </span>
        <input
          placeholder="Ask about your sources"
          aria-label="Ask about your sources"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          aria-label="Open question in assistant"
          type="submit"
        >
          <ArrowUp size={20} />
        </button>
      </form>
      <div className="suggestions">
        <span>A little help?</span>
        {[
          "Summarize my sources",
          "Explain a concept",
          "Create a study plan",
        ].map((t) => (
          <button key={t} onClick={() => openQuestion(t)}>
            {t}
            <ArrowUpRight size={12} />
          </button>
        ))}
      </div>
      <section className="section">
        <div className="section-heading">
          <div>
            <h2>Pick up where you left off</h2>
            <p>A home for every subject, project, and rabbit hole.</p>
          </div>
          <button
            className="text-button"
            onClick={() => navigate("/notebooks")}
          >
            All notebooks
            <ArrowRight size={15} />
          </button>
        </div>
        <NotebookLibrary
          search=""
          onRename={(id, name) => openModal("notebook", id, name)}
          onDelete={onDelete}
        />
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <h2>A different way to make it stick</h2>
            <p>Turn what you’re learning into what you know.</p>
          </div>
          <span className="subtle-badge">YOUR STUDY TOOLKIT</span>
        </div>
        <div className="tools-grid">
          {tools.map((t) => (
            <button
              className={`tool-card ${t.color}`}
              key={t.path}
              onClick={() => navigate(t.path)}
            >
              <span className="tool-icon">
                <t.icon size={23} />
              </span>
              <h3>{t.name}</h3>
              <p>{t.desc}</p>
              <ArrowUpRight className="tool-arrow" size={18} />
            </button>
          ))}
        </div>
      </section>
      <div className="footer-note">
        <BookOpen size={15} />A little progress, every day.
        <span>You’ve got this.</span>
      </div>
    </motion.div>
  );
}
