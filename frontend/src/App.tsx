import React, { useState, useRef, useEffect } from "react";

import {
  NavLink,
  Routes,
  Route,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  BookOpen,
  Home,
  FolderOpen,
  Files,
  MessageCircle,
  NotebookPen,
  Layers,
  ClipboardList,
  Network,
  Timer,
  Search,
  Sun,
  Moon,
  PanelLeftClose,
  Plus,
  ArrowUpRight,
  ArrowRight,
  FileText,
  X,
  ChevronRight,
  Sparkles,
  Download,
  LogOut,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { useStore, type Source } from "./store";
import { api, json, waitForJob } from "./api";
import { useSession, avatarSymbols } from "./Session";
import { LogoMark } from "./LogoMark";
import "./style.css";
import "./features/workspace.css";
import "./features/profile/profile.css";
import HomePage from "./features/home/HomePage";
import SourcesPage from "./features/sources/SourcesPage";
import AssistantPage from "./features/assistant/AssistantPage";
import NotebookLibrary from "./features/notebooks/NotebookLibrary";
const ProfilePage = React.lazy(() => import("./features/profile/ProfilePage"));
const CloudPanel = React.lazy(() => import("./CloudPanel"));
const Notes = React.lazy(() => import("./features/notes/NotesPage"));
const Flashcards = React.lazy(
  () => import("./features/flashcards/FlashcardsPage"),
);
const Quiz = React.lazy(() => import("./features/quizzes/QuizPage"));
const MindMap = React.lazy(() => import("./features/mindmaps/MindMapPage"));
const Focus = React.lazy(() => import("./features/focus/FocusPage"));

const nav = [
  ["/workspace", "Home", Home],
  ["/notebooks", "Notebooks", FolderOpen],
  ["/sources", "Sources", Files],
  ["/chat", "AI Assistant", MessageCircle],
  ["/notes", "Notes", NotebookPen],
  ["/flashcards", "Flashcards", Layers],
  ["/quizzes", "Quizzes", ClipboardList],
  ["/mindmaps", "Mind Maps", Network],
  ["/focus", "Focus Timer", Timer],
] as const;

const SIDEBAR_DEFAULT = 260;
const SIDEBAR_MIN = 208;
const SIDEBAR_MAX = 380;
const SIDEBAR_STORAGE_KEY = "cdmento-sidebar-width";

function readSidebarWidth() {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX)
      return saved;
  } catch {
    // Storage can be unavailable (private mode). Fall back to the default.
  }
  return SIDEBAR_DEFAULT;
}

export default function App() {
  const { user: firebaseUser, demo, logout, account } = useSession();
  const user = firebaseUser || demo;
  const s = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [cloud, setCloud] = useState(false);
  const [collapsed, collapse] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ kind: string; id?: string } | null>(
    null,
  );
  const [value, setValue] = useState("");
  const [profile, setProfile] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch (error: any) {
      toast.error(error.message || "Could not log out. Please retry.");
      setLoggingOut(false);
    }
  }
  const displayName = account?.display_name || user?.displayName || "Student";
  const avatar =
    avatarSymbols[account?.avatar || ""] || displayName.charAt(0).toUpperCase();
  const [preview, setPreview] = useState<Source | null>(null);
  useEffect(() => {
    let active = true;
    (demo ? Promise.resolve() : api("/me/profile", { method: "PUT" }))
      .then(() => {
        if (active) useStore.getState().initialize();
      })
      .catch(() => {
        if (active)
          useStore.setState({
            sync: "We couldn’t open your account. Please try reconnecting.",
            ready: false,
          });
      });
    return () => {
      active = false;
    };
  }, [user?.uid]);
  useEffect(() => {
    if (
      !s.ready ||
      !s.sources.some((source) =>
        ["queued", "extracting", "indexing", "ocr"].includes(
          source.status || "",
        ),
      )
    )
      return;
    const id = window.setInterval(
      () =>
        useStore
          .getState()
          .refresh()
          .catch(() => {}),
      2000,
    );
    return () => clearInterval(id);
  }, [s.ready, s.sources]);
  const input = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const notebook = s.notebooks.find((n) => n.id === s.active);
  const sources = s.sources.filter((x) => x.notebook === s.active);
  const applySidebarWidth = (width: number) => {
    const next = Math.min(
      SIDEBAR_MAX,
      Math.max(SIDEBAR_MIN, Math.round(width)),
    );
    setSidebarWidth(next);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures; the width still applies for this session.
    }
  };
  useEffect(() => {
    if (!resizingSidebar) return;
    const move = (event: PointerEvent) => {
      setSidebarWidth(
        Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, event.clientX)),
      );
    };
    const stop = () => {
      setSidebarWidth((width) => {
        try {
          localStorage.setItem(SIDEBAR_STORAGE_KEY, String(width));
        } catch {
          // Ignore storage failures.
        }
        return width;
      });
      setResizingSidebar(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [resizingSidebar]);
  useEffect(() => {
    document.body.classList.toggle("sidebar-resizing", resizingSidebar);
    return () => document.body.classList.remove("sidebar-resizing");
  }, [resizingSidebar]);
  useEffect(() => {
    const closeMobileOnWide = () => {
      if (window.innerWidth >= 800) setMobile(false);
    };
    window.addEventListener("resize", closeMobileOnWide);
    return () => window.removeEventListener("resize", closeMobileOnWide);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = s.dark ? "dark" : "light";
  }, [s.dark]);
  useEffect(() => {
    setMobile(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        setPreview(null);
        setCloud(false);
        setProfile(false);
        setMobile(false);
      }
      const target = event.target as HTMLElement;
      if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA"].includes(target.tagName) &&
        !target.isContentEditable
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openModal = (kind: string, id?: string, name = "") => {
    setValue(name);
    setModal({ kind, id });
  };
  const saveModal = async () => {
    if (!value.trim()) return;
    if (modal?.kind === "source")
      s.set({
        sources: s.sources.map((n) =>
          n.id === modal.id ? { ...n, name: value.trim() } : n,
        ),
      });
    else if (modal?.id)
      s.set({
        notebooks: s.notebooks.map((n) =>
          n.id === modal.id ? { ...n, name: value.trim() } : n,
        ),
      });
    else {
      const id = crypto.randomUUID();
      s.set({
        notebooks: [
          ...s.notebooks,
          { id, name: value.trim(), color: "purple" },
        ],
        active: id,
      });
    }
    setModal(null);
    try {
      await useStore.getState().flush();
      toast.success("Saved to your workspace");
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  const chooseFiles = () => {
    if (!s.active) {
      openModal("notebook");
      toast.info("Create a notebook first to organize your files.");
      return;
    }
    input.current?.click();
  };
  async function upload(files: FileList | null) {
    if (!files) return;
    if (!s.active) {
      chooseFiles();
      return;
    }
    const nid = s.active;
    for (const file of Array.from(files)) {
      const loading = toast.loading(`Uploading ${file.name}…`);
      try {
        await useStore.getState().flush();
        const form = new FormData();
        form.append("file", file);
        const result = await api(`/notebooks/${nid}/sources`, {
          method: "POST",
          body: form,
        });
        await useStore.getState().refresh();
        if (result.job_id) {
          toast.loading(`Processing ${file.name}…`, { id: loading });
          await waitForJob(result.job_id);
        }
        await useStore.getState().refresh();
        toast.success(
          result.duplicate
            ? "This file is already in the notebook."
            : `${file.name} is ready`,
          { id: loading },
        );
      } catch (e: any) {
        toast.error(e.message, { id: loading });
        await useStore
          .getState()
          .refresh()
          .catch(() => {});
      }
    }
    if (input.current) input.current.value = "";
  }
  const title =
    location.pathname === "/profile"
      ? "Profile"
      : nav.find((n) => n[0] === location.pathname)?.[1] || "Home";
  useEffect(() => {
    document.title = `${title} — CdMento`;
  }, [title]);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept=".pdf,.docx,.txt"
        onChange={(e) => upload(e.target.files)}
      />
      <div
        className={`app ${collapsed ? "collapsed" : ""} ${
          resizingSidebar ? "resizing-sidebar" : ""
        }`}
        style={
          { "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties
        }
      >
        {mobile && (
          <button
            className="mobile-overlay"
            aria-label="Dismiss navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
          <a className="brand" href="/" aria-label="CdMento home">
            <span className="brand-mark">
              <LogoMark tone="brand" />
            </span>
            <span>
              CdMento
              <small>YOUR SPACE TO UNDERSTAND</small>
            </span>
          </a>
          <button
            className="mobile-close icon-button"
            onClick={() => setMobile(false)}
            aria-label="Close navigation"
          >
            <X />
          </button>
          <div className="workspace-label">WORKSPACE</div>
          <nav>
            {nav.map(([path, label, Icon]) => (
              <NavLink end={path === "/workspace"} to={path} key={path}>
                <Icon size={19} />
                <span>{label}</span>
                {path === "/chat" && <span className="ai-label">AI</span>}
              </NavLink>
            ))}
          </nav>
          <div className="recent-label">
            YOUR NOTEBOOKS
            <button
              aria-label="Create notebook"
              onClick={() => openModal("notebook")}
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="sidebar-notebooks">
            {(s.ready ? s.notebooks : []).slice(0, 4).map((n) => (
              <button
                className={s.active === n.id ? "selected" : ""}
                key={n.id}
                onClick={() => {
                  s.set({ active: n.id });
                  navigate("/sources");
                }}
              >
                <span className={`little-dot ${n.color}`} />
                <span>{n.name}</span>
              </button>
            ))}
          </div>
          <div className="sidebar-bottom">
            <div className="quiet-card">
              <Sparkles size={19} />
              <p>
                Big ideas start with
                <br />a little curiosity.
              </p>
              <div className="quiet-hills" />
            </div>
            <button
              className="user"
              aria-label="Open your profile"
              onClick={() => {
                navigate("/profile");
                setMobile(false);
              }}
            >
              <span
                className={`avatar account-avatar avatar-${account?.color || "purple"}`}
              >
                {avatar}
              </span>
              <span>
                {displayName}
                <small>
                  {demo ? "Local demo account" : "Make something click."}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button
              className="sidebar-logout"
              disabled={loggingOut}
              onClick={handleLogout}
            >
              <LogOut size={16} />
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </aside>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          aria-valuenow={sidebarWidth}
          aria-valuetext={`${sidebarWidth} pixels`}
          tabIndex={collapsed ? -1 : 0}
          title={`Drag to resize (${sidebarWidth}px) · Double-click to reset`}
          onPointerDown={(event) => {
            if (collapsed || window.innerWidth < 800) return;
            event.preventDefault();
            (event.currentTarget as HTMLElement).setPointerCapture(
              event.pointerId,
            );
            setResizingSidebar(true);
          }}
          onDoubleClick={() => applySidebarWidth(SIDEBAR_DEFAULT)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              applySidebarWidth(
                sidebarWidth + (event.key === "ArrowRight" ? 16 : -16),
              );
            } else if (event.key === "Home") {
              event.preventDefault();
              applySidebarWidth(SIDEBAR_DEFAULT);
            }
          }}
        />
        <div className="shell">
          <header>
            <div className="header-left">
              <button
                className="icon-button"
                aria-label="Toggle sidebar"
                onClick={() =>
                  window.innerWidth < 800
                    ? setMobile(!mobile)
                    : collapse(!collapsed)
                }
              >
                <PanelLeftClose size={19} />
              </button>
              <span className="breadcrumb">
                Workspace <ChevronRight size={14} />
                <b>{title}</b>
              </span>
            </div>
            <div className="header-right">
              <label className="search">
                <Search size={16} />
                <input
                  ref={searchInput}
                  aria-label="Search notebooks"
                  placeholder="Search notebooks…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    if (e.target.value) navigate("/notebooks");
                  }}
                />
                <kbd>/</kbd>
              </label>
              <button
                className="icon-button theme"
                aria-label="Toggle color theme"
                onClick={() => s.set({ dark: !s.dark })}
              >
                {s.dark ? <Sun size={19} /> : <Moon size={19} />}
              </button>
              <div className="profile-wrap">
                <button
                  className={`avatar account-avatar avatar-${account?.color || "purple"}`}
                  aria-label="Open profile"
                  onClick={() => navigate("/profile")}
                >
                  {avatar}
                </button>
                <button
                  className="icon-button"
                  aria-label="Account options"
                  aria-expanded={profile}
                  onClick={() => setProfile(!profile)}
                >
                  <MoreHorizontal size={17} />
                </button>
                {profile && (
                  <div className="profile-menu">
                    <b>{displayName}</b>
                    <p>{user?.email}</p>
                    <button
                      onClick={() => {
                        navigate("/profile");
                        setProfile(false);
                      }}
                    >
                      Your account
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setProfile(false);
                        navigate("/");
                      }}
                    >
                      <ArrowRight size={14} />
                      Home page
                    </button>
                    <button
                      className="secondary"
                      onClick={async () => {
                        await handleLogout();
                        setProfile(false);
                      }}
                    >
                      <LogOut size={14} />
                      Sign out
                    </button>
                    <button
                      onClick={async () => {
                        await s.flush();
                        const exported = await api("/workspace/export");
                        const blob = new Blob(
                          [JSON.stringify(exported, null, 2)],
                          {
                            type: "application/json",
                          },
                        );
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "cdmento-backup.json";
                        a.click();
                        URL.revokeObjectURL(url);
                        setProfile(false);
                      }}
                    >
                      <Download size={15} />
                      Export workspace
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <div className="content-layout">
            <main data-feature={location.pathname.slice(1)}>
              {!s.ready && (
                <div className="connection-banner">
                  <span>{s.sync}</span>
                  <button onClick={() => useStore.getState().initialize()}>
                    Reconnect
                  </button>
                  <button onClick={() => setCloud(true)}>Account</button>
                </div>
              )}
              {s.ready && s.sync !== "Saved" && (
                <div className="save-status">
                  <span>{s.sync}</span>
                  {s.sync === "Save failed" && (
                    <button
                      onClick={() =>
                        s.flush().catch((e) => toast.error(e.message))
                      }
                    >
                      Retry saving
                    </button>
                  )}
                </div>
              )}
              {s.recovery && (
                <div className="connection-banner">
                  <span>
                    Unsaved notes from an earlier session were preserved.
                  </span>
                  <button onClick={() => s.restoreRecovery()}>
                    Restore as copies
                  </button>
                  <button
                    onClick={() => {
                      const blob = new Blob([json(s.recovery)], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "cdmento-unsaved-notes.json";
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download backup
                  </button>
                </div>
              )}
              {s.pendingImport && (
                <div className="connection-banner">
                  <span>
                    Your previous local notebooks are backed up. Import them
                    into this workspace?
                  </span>
                  <button
                    onClick={() =>
                      s.importLocal().catch((e) => toast.error(e.message))
                    }
                  >
                    Import my notebooks
                  </button>
                  <button
                    onClick={() => useStore.setState({ pendingImport: null })}
                  >
                    Later
                  </button>
                </div>
              )}
              {s.ready &&
                s.active &&
                sources.length > 0 &&
                ["/chat", "/flashcards", "/quizzes", "/mindmaps"].includes(
                  location.pathname,
                ) && (
                  <details className="source-selection">
                    <summary>
                      Study sources ·{" "}
                      {s.selectedSources === null
                        ? "All ready sources"
                        : `${s.selectedSources.length} selected`}
                    </summary>
                    <button
                      className="text-button"
                      onClick={() => s.selectSources(null)}
                    >
                      Use all ready sources
                    </button>
                    {sources.map((source) => (
                      <label key={source.id}>
                        <input
                          type="checkbox"
                          disabled={source.status !== "ready"}
                          checked={
                            source.status === "ready" &&
                            (s.selectedSources === null ||
                              s.selectedSources.includes(source.id))
                          }
                          onChange={(e) => {
                            const ids =
                              s.selectedSources ??
                              sources
                                .filter((x) => x.status === "ready")
                                .map((x) => x.id);
                            s.selectSources(
                              e.target.checked
                                ? [...ids, source.id]
                                : ids.filter((id) => id !== source.id),
                            );
                          }}
                        />
                        {source.name}
                        <small>{source.status}</small>
                      </label>
                    ))}
                  </details>
                )}

              {s.ready &&
                s.active &&
                !["/workspace", "/notebooks", "/sources", "/profile"].includes(
                  location.pathname,
                ) && (
                  <div className="active-notebook">
                    <FolderOpen size={14} />
                    <select
                      aria-label="Active notebook"
                      value={s.active}
                      onChange={(e) => s.set({ active: e.target.value })}
                    >
                      {s.notebooks.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              {!s.ready ? (
                <Empty text="Connect to your workspace to continue." />
              ) : !s.active &&
                [
                  "/notes",
                  "/chat",
                  "/flashcards",
                  "/quizzes",
                  "/mindmaps",
                ].includes(location.pathname) ? (
                <>
                  <PageTitle
                    title="Start with your first notebook"
                    desc="Create a notebook for your subject, project, or ideas."
                  />
                  <button
                    className="primary"
                    onClick={() => openModal("notebook")}
                  >
                    <Plus size={17} />
                    New notebook
                  </button>
                </>
              ) : (
                <React.Suspense
                  fallback={<Empty text="Opening your workspace…" />}
                >
                  <Routes>
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route
                      path="/workspace"
                      element={
                        <HomePage
                          chooseFiles={chooseFiles}
                          openModal={openModal}
                          onDelete={(id) => setModal({ kind: "delete", id })}
                        />
                      }
                    />
                    <Route
                      path="/notebooks"
                      element={
                        <section className="feature-screen notebooks-screen">
                          <PageTitle
                            title="Your personal library"
                            desc="A little organization makes room for bigger ideas."
                          />
                          <button
                            className="primary page-action"
                            onClick={() => openModal("notebook")}
                          >
                            <Plus size={17} />
                            New notebook
                          </button>
                          <NotebookLibrary
                            allowViewSwitch
                            search={search}
                            onRename={(id, name) =>
                              openModal("notebook", id, name)
                            }
                            onDelete={(id) => setModal({ kind: "delete", id })}
                          />
                        </section>
                      }
                    />
                    <Route
                      path="/sources"
                      element={
                        <SourcesPage
                          key={s.active}
                          onCreateNotebook={() => openModal("notebook")}
                        />
                      }
                    />
                    <Route path="/chat" element={<AssistantPage />} />
                    <Route path="/notes" element={<Notes />} />
                    <Route
                      path="/flashcards"
                      element={<Flashcards key={s.active} />}
                    />
                    <Route path="/quizzes" element={<Quiz key={s.active} />} />
                    <Route
                      path="/mindmaps"
                      element={<MindMap key={s.active} />}
                    />
                    <Route path="/focus" element={<Focus />} />
                    <Route
                      path="*"
                      element={
                        <>
                          <PageTitle
                            title="Let’s head back"
                            desc="This page doesn’t exist."
                          />
                          <button
                            className="primary"
                            onClick={() => navigate("/workspace")}
                          >
                            Go home
                          </button>
                        </>
                      }
                    />
                  </Routes>
                </React.Suspense>
              )}
            </main>
            {location.pathname === "/workspace" && (
              <aside className="right-panel">
                <div className="context-tabs">
                  <button className="active">
                    <Files size={16} />
                    Sources<span>{sources.length}</span>
                  </button>
                  <button onClick={() => navigate("/notes")}>
                    <NotebookPen size={16} />
                    Notes
                  </button>
                </div>
                <div className="right-section">
                  <div className="right-heading">
                    <h3>In your workspace</h3>
                    <button aria-label="Add source" onClick={chooseFiles}>
                      <Plus size={17} />
                    </button>
                  </div>
                  <select
                    value={s.active}
                    onChange={(e) => s.set({ active: e.target.value })}
                  >
                    {s.notebooks.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                  {sources.map((file) => (
                    <div className="source-row" key={file.id}>
                      <button
                        className="source-open"
                        onClick={() => setPreview(file)}
                      >
                        <span className={`file-icon ${file.type}`}>
                          <FileText size={19} />
                        </span>
                        <span>
                          <b>{file.name}</b>
                          <small>
                            {file.type.toUpperCase()} · Ready to explore
                          </small>
                        </span>
                      </button>
                      <ChevronRight size={14} />
                    </div>
                  ))}
                  <button className="add-source" onClick={chooseFiles}>
                    <Plus size={16} />
                    Add a source
                  </button>
                </div>
                <div className="insight-card">
                  <span className="eyebrow">
                    <Sparkles size={16} /> A FRESH PERSPECTIVE
                  </span>
                  <h3>
                    Knowledge grows
                    <br />
                    when you connect it.
                  </h3>
                  <p>
                    Start with a source. Ask a question.
                    <br />
                    See where your curiosity takes you.
                  </p>
                  <button onClick={() => navigate("/chat")}>
                    Explore with CdMento
                    <ArrowRight size={15} />
                  </button>
                  <div className="insight-art">
                    <span />
                    <span />
                    <span />
                    <i />
                  </div>
                </div>
                <div className="session-card">
                  <div className="session-icon">
                    <Timer size={20} />
                  </div>
                  <div>
                    <h3>A moment of focus</h3>
                    <p>Small sessions. Meaningful progress.</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Open focus timer"
                    onClick={() => navigate("/focus")}
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
                <div className="right-bottom">
                  <span className="little-dot green" />
                  Your workspace is saved by the backend
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>
      {cloud && (
        <React.Suspense fallback={null}>
          <CloudPanel close={() => setCloud(false)} />
        </React.Suspense>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal.kind === "delete" ? "Delete notebook" : "Notebook details"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            <span className="tool-icon purple">
              <FolderOpen size={24} />
            </span>
            <h2>
              {modal.kind === "delete"
                ? "Delete this notebook?"
                : modal.kind === "source"
                  ? "Rename source"
                  : modal.id
                    ? "Rename notebook"
                    : "Room for a new idea"}
            </h2>
            <p>
              {modal.kind === "delete"
                ? "Its notes and sources will also be removed. This cannot be undone."
                : "Give it a name that makes sense to you."}
            </p>
            {modal.kind !== "delete" && (
              <input
                autoFocus
                maxLength={80}
                placeholder="e.g. Introduction to Psychology"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveModal()}
              />
            )}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={modal.kind !== "delete" && !value.trim()}
                onClick={() => {
                  if (modal.kind === "delete") {
                    const remaining = s.notebooks.filter(
                      (n) => n.id !== modal.id,
                    );
                    s.set({
                      notebooks: remaining,
                      notes: s.notes.filter((n) => n.notebook !== modal.id),
                      sources: s.sources.filter((n) => n.notebook !== modal.id),
                      active:
                        s.active === modal.id
                          ? remaining[0]?.id || ""
                          : s.active,
                    });
                    setModal(null);
                  } else saveModal();
                }}
              >
                {modal.kind === "delete"
                  ? "Delete notebook"
                  : modal.kind === "source"
                    ? "Save source"
                    : "Save notebook"}
              </button>
            </div>
          </div>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal preview" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close icon-button"
              aria-label="Close preview"
              onClick={() => setPreview(null)}
            >
              <X />
            </button>
            <h2>{preview.name}</h2>
            <p>Extracted source text</p>
            <pre>{preview.text}</pre>
          </div>
        </div>
      )}
    </>
  );
}
function PageTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="page-title">
      <span className="eyebrow">YOUR LEARNING SPACE</span>
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
