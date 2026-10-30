import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  GraduationCap,
  Layers,
  LoaderCircle,
  Mail,
  Menu,
  Network,
  Pause,
  Play,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Timer,
  Upload,
  X,
} from "lucide-react";
import {
  applyActionCode,
  browserLocalPersistence,
  browserSessionPersistence,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  updateProfile,
  verifyPasswordResetCode,
} from "firebase/auth";
import { firebaseAuth } from "./auth";
import { api, ApiError } from "./api";
import { useSession } from "./Session";
import { safeNext } from "./paths";
import { FlashcardDemo, QuizDemo } from "./ProgrammingDemos";
import { FlowingPaths } from "./FlowingPaths";
import { LogoMark } from "./LogoMark";
import { initScrollEffects } from "./scroll-effects.js";
import TopoBackground from "./TopoBackground";
import { ThemeToggle } from "./PublicTheme";

export function PublicBrand() {
  return (
    <Link to="/" className="pub-brand" aria-label="CdMento home">
      <span>
        <LogoMark />
      </span>
      CdMento
    </Link>
  );
}
const fade = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.5 },
};

function StudyPreview() {
  const [tab, setTab] = useState("Flashcards");
  const [note, edit] = useState(
    "JavaScript basics: variables store values, conditions make decisions, loops repeat tasks, and functions organize reusable code.",
  );
  return (
    <div className="study-preview" id="preview">
      <div className="preview-top">
        <div className="window-dots">
          <i />
          <i />
          <i />
        </div>
        <span>YOUR NEXT LIGHTBULB MOMENT</span>
        <span className="preview-label">Live demo</span>
      </div>
      <div className="preview-layout">
        <aside className="preview-side">
          <PublicBrand />
          <span className="preview-side-label">MY WORKSPACE</span>
          <div className="preview-side-active">
            <BookOpen size={17} /> Programming basics
          </div>
          <div>
            <FileText size={17} /> My notes
          </div>
          <div>
            <Layers size={17} /> Flashcards
          </div>
          <div>
            <Network size={17} /> Mind maps
          </div>
          <div className="preview-focus">
            <Timer size={20} />
            <b>A little focus goes a long way.</b>
            <span>Make time for what matters.</span>
          </div>
        </aside>
        <div className="preview-content">
          <div className="preview-heading">
            <div>
              <span className="eyebrow">TRY A SAMPLE LESSON</span>
              <h3>Programming 101.</h3>
            </div>
            <span className="preview-topic">
              <span /> JavaScript
            </span>
          </div>
          <div
            className="preview-tabs"
            role="tablist"
            aria-label="Try study tools"
          >
            {["Flashcards", "Quick quiz", "Notes"].map((name) => (
              <button
                key={name}
                id={`tab-${name.replaceAll(" ", "-")}`}
                role="tab"
                tabIndex={tab === name ? 0 : -1}
                aria-selected={tab === name}
                aria-controls="study-demo-panel"
                onClick={() => setTab(name)}
                onKeyDown={(event) => {
                  const names = ["Flashcards", "Quick quiz", "Notes"];
                  const index = names.indexOf(name);
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % 3
                      : event.key === "ArrowLeft"
                        ? (index + 2) % 3
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? 2
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setTab(names[next]);
                  document
                    .getElementById(`tab-${names[next].replaceAll(" ", "-")}`)
                    ?.focus();
                }}
              >
                {tab === name && (
                  <motion.span layoutId="preview-tab" className="tab-pill" />
                )}
                <span>{name}</span>
              </button>
            ))}
          </div>
          <div
            className="demo-panel"
            id="study-demo-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab.replaceAll(" ", "-")}`}
          >
            <div hidden={tab !== "Flashcards"}>
              <FlashcardDemo />
            </div>
            <div hidden={tab !== "Quick quiz"}>
              <QuizDemo />
            </div>
            <div hidden={tab !== "Notes"}>
              <div className="demo-notes">
                <label htmlFor="preview-note">My programming notes.</label>
                <textarea
                  id="preview-note"
                  value={note}
                  onChange={(e) => edit(e.target.value)}
                  maxLength={1000}
                />
                <small>
                  This preview stays on this page. Your workspace notes save to
                  your account.
                </small>
              </div>
            </div>
          </div>
          <div className="preview-bottom">
            <span>
              <ShieldCheck size={15} /> Sample lesson · no sign-in needed.
            </span>
            <span>Small steps. Real understanding.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
export function Landing() {
  const [menu, showMenu] = useState(false);
  const [animationPaused, pauseAnimation] = useState(false);
  useEffect(() => {
    document.title = "CdMento — Make room for your next lightbulb moment";
    return initScrollEffects(document.querySelector(".playful-landing"));
  }, []);
  return (
    <div
      className={`public-site playful-landing${animationPaused ? " motion-paused" : ""}`}
    >
      <div className="landing-scroll-progress" aria-hidden="true" />
      <a className="pub-skip" href="#landing-content">
        Skip to content
      </a>
      <header className="public-header">
        <PublicBrand />
        <nav
          aria-label="Main navigation"
          className={menu ? "public-nav open" : "public-nav"}
        >
          <a href="#features" onClick={() => showMenu(false)}>
            Why CdMento
          </a>
          <a href="#how-it-works" onClick={() => showMenu(false)}>
            How it works
          </a>
          <Link to="/get-app" onClick={() => showMenu(false)}>
            Get the app <span className="soon-dot" />
          </Link>
        </nav>
        <div className="public-header-actions">
          <ThemeToggle />
          <Link className="pub-login-link" to="/login">
            Log in
          </Link>
          <Link className="pub-button small" to="/signup">
            Start learning <ArrowUp />
          </Link>
          <button
            className="pub-menu"
            aria-label={menu ? "Close navigation" : "Open navigation"}
            aria-expanded={menu}
            onClick={() => showMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main id="landing-content" className="landing-main">
        <section className="landing-hero">
          <FlowingPaths paused={animationPaused} />
          <button
            className="animation-toggle"
            aria-pressed={animationPaused}
            onClick={() => pauseAnimation(!animationPaused)}
          >
            {animationPaused ? <Play size={13} /> : <Pause size={13} />}
            {animationPaused ? "Play animations" : "Pause animations"}
          </button>
          <motion.div {...fade} className="hero-copy">
            <span className="hero-badge">
              <Sparkles size={13} /> A little curiosity. A lot of possibility.
            </span>
            <h1>
              Less cramming.
              <br />
              <span className="live-headline">
                More lightbulbs<span className="purple-stop">.</span>
                <svg
                  className="headline-underline"
                  viewBox="0 0 600 20"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M5 14 Q290 -1 595 10" />
                </svg>
              </span>
            </h1>
            <p>
              Your notes. Your flashcards. Your next “I get it.”
              <br className="desktop-break" /> A brighter place to find your
              study flow.
            </p>
            <div className="hero-actions">
              <Link to="/signup" className="pub-button">
                Find your study flow <ArrowRight size={18} />
              </Link>
              <a className="pub-secondary" href="#preview">
                Try the live demo <ArrowDown size={16} />
              </a>
            </div>
            <span className="hero-footnote">
              <Check size={14} /> A space to learn at your own pace
            </span>
          </motion.div>
          <span className="hero-star star-one" aria-hidden="true">
            ✦
          </span>
          <span className="hero-star star-two" aria-hidden="true">
            ✧
          </span>
          <span className="hero-star star-three" aria-hidden="true">
            ✦
          </span>
          <div className="curious-bulb" aria-hidden="true">
            <svg viewBox="0 0 130 155" fill="none">
              <path
                d="M43 100C37 89 20 78 20 52a45 45 0 0 1 90 0c0 26-17 37-23 48"
                fill="var(--mascot-bulb, #f0ca78)"
                stroke="#212629"
                strokeWidth="4"
              />
              <path
                d="M43 100h44v22a22 22 0 0 1-44 0z"
                fill="var(--mascot-base, #697a81)"
                stroke="#212629"
                strokeWidth="4"
              />
              <path d="M44 110h42M47 121h36" stroke="#212629" strokeWidth="4" />
              <ellipse cx="49" cy="58" rx="5" ry="8" fill="#212629" />
              <ellipse cx="81" cy="58" rx="5" ry="8" fill="#212629" />
              <path
                d="M53 77q12 13 24 0"
                stroke="#212629"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M10 25 2 20M119 25l9-5M65 4V0"
                stroke="#212629"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <ellipse cx="40" cy="72" rx="7" ry="4" fill="#e29970" />
              <ellipse cx="90" cy="72" rx="7" ry="4" fill="#e29970" />
            </svg>
            <span>Aha!</span>
          </div>
          <div className="floating-note note-one" aria-hidden="true">
            <span className="float-icon">
              <Layers size={18} />
            </span>
            A little practice.
            <br />
            <b>A lot remembered.</b>
          </div>
          <div className="floating-note note-two" aria-hidden="true">
            <span className="float-icon mint">
              <Check size={18} />
            </span>
            One step closer
            <br />
            <b>to “I get it.”</b>
          </div>
          <motion.div
            {...fade}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="preview-wrap"
          >
            <StudyPreview />
          </motion.div>
        </section>
        <section className="tools-strip" aria-label="Your study toolkit">
          A home for every part of learning <span />
          <b>
            <FileText /> Notes
          </b>
          <b>
            <Layers /> Flashcards
          </b>
          <b>
            <GraduationCap /> Quizzes
          </b>
          <b>
            <Network /> Mind maps
          </b>
          <b>
            <Timer /> Focus
          </b>
        </section>
        <section id="features" className="public-section features-section">
          <motion.div {...fade} className="section-intro">
            <span className="eyebrow">LESS SCATTERED. MORE CONNECTED.</span>
            <h2>
              Give your study life
              <br />a little breathing room.
            </h2>
            <p>
              From the first page to the final review, keep the things you’re
              learning in one thoughtful space.
            </p>
          </motion.div>
          <div className="feature-grid">
            <motion.article {...fade} className="feature-block feature-wide">
              <div>
                <span className="feature-symbol lavender">
                  <BookOpen />
                </span>
                <h3>
                  Your materials.
                  <br />A place of their own.
                </h3>
                <p>
                  Bring your files and notes together in notebooks for each
                  subject. Spend less time searching and more time connecting
                  ideas.
                </p>
              </div>
              <div
                className="mini-notebooks"
                aria-label="Example notebook organization"
              >
                <div>
                  <span className="mini-book violet">
                    <BookOpen />
                  </span>
                  <span>
                    Biology notes<small>Everything, in its place</small>
                  </span>
                  <ChevronDown size={15} />
                </div>
                <div>
                  <span className="mini-book peach">
                    <BookOpen />
                  </span>
                  <span>
                    Design principles<small>Room for your next idea</small>
                  </span>
                  <ChevronDown size={15} />
                </div>
                <span className="example-caption">
                  Example notebooks · you create your own
                </span>
              </div>
            </motion.article>
            <motion.article
              {...fade}
              className="feature-block feature-practice"
            >
              <span className="feature-symbol peach">
                <Layers />
              </span>
              <h3>
                Make remembering
                <br />a little more active.
              </h3>
              <p>
                Practice with flashcards and quizzes. Find the gaps, revisit the
                tricky bits, and learn one question at a time.
              </p>
              <div className="mini-card-stack" aria-hidden="true">
                <div />
                <div />
                <div>
                  <Sparkles size={21} />
                  <b>Oh, now it clicks.</b>
                  <span>A little progress, every day.</span>
                </div>
              </div>
            </motion.article>
            <motion.article {...fade} className="feature-block feature-focus">
              <span className="feature-symbol mint">
                <Timer />
              </span>
              <h3>
                One thing at a time.
                <br />
                You’ve got this.
              </h3>
              <p>
                Set a focus timer, make space for a break, and give your
                attention to the task in front of you.
              </p>
              <div className="mini-timer" aria-hidden="true">
                <svg viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" />
                  <circle cx="60" cy="60" r="52" />
                </svg>
                <span>
                  <b>25:00</b>
                  <small>TIME TO FOCUS</small>
                </span>
              </div>
            </motion.article>
          </div>
          <p className="ai-development-note">
            AI-assisted reviewers, flashcards, quizzes, mind maps, and
            source-grounded chat are available in the workspace once a free-tier
            provider is connected. Provider switching is automatic.
          </p>
        </section>
        <section id="how-it-works" className="public-section how-section">
          <div className="section-intro">
            <span className="eyebrow">
              FROM “WHERE DO I START?” TO “I’VE GOT THIS.”
            </span>
            <h2>A simpler study rhythm.</h2>
          </div>
          <div className="how-steps">
            {[
              {
                icon: Upload,
                title: "Bring it together",
                text: "Create a notebook and upload your course materials. Give every subject a home.",
              },
              {
                icon: FileText,
                title: "Make it your own",
                text: "Write notes, organize your thoughts, and connect the ideas that matter.",
              },
              {
                icon: GraduationCap,
                title: "Keep showing up",
                text: "Review a little, practice what you know, and build your own study routine.",
              },
            ].map(({ icon: Icon, title, text }, i) => (
              <motion.article {...fade} key={title}>
                <div className="step-top">
                  <span>0{i + 1}</span>
                  <Icon size={25} />
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </motion.article>
            ))}
          </div>
        </section>
        <TopoBackground
          className="public-section final-cta"
          paused={animationPaused}
          speed={0.45}
          interval={0.085}
          labels={false}
        >
          <div className="final-cta-content">
            <span className="footer-spark" aria-hidden="true">
              ✧
            </span>
            <h2>
              Let’s make room
              <br />
              for your next big idea.
            </h2>
            <Link to="/signup" className="pub-button">
              Start your next chapter <ArrowRight size={18} />
            </Link>
            <p>Your materials. Your pace. Your CdMento.</p>
            <button
              className="footer-motion-toggle"
              aria-pressed={animationPaused}
              onClick={() => pauseAnimation(!animationPaused)}
            >
              {animationPaused ? <Play size={13} /> : <Pause size={13} />}
              {animationPaused ? "Resume background" : "Pause background"}
            </button>
          </div>
        </TopoBackground>
      </main>
      <footer className="public-footer">
        <PublicBrand />
        <span>A little curiosity goes a long way.</span>
        <a href="#landing-content">Back to top ↑</a>
        <small>© {new Date().getFullYear()} CdMento</small>
      </footer>
    </div>
  );
}
export function GetAppPage() {
  useEffect(() => {
    document.title = "Get the app — CdMento";
  }, []);
  return (
    <div className="public-site get-app-site">
      <header className="public-header">
        <PublicBrand />
        <div className="public-header-actions">
          <ThemeToggle />
          <Link className="auth-back" to="/">
            <ArrowLeft size={15} /> Back to home
          </Link>
        </div>
      </header>
      <main className="get-app-main">
        <section id="download" className="public-section download-section">
          <div className="download-copy">
            <span className="eyebrow">A LITTLE LEARNING. ANYWHERE.</span>
            <h1>
              Your study buddy.
              <br />
              Soon, in your pocket.
            </h1>
            <p>
              We’re working on a CdMento mobile app so your next study session
              can happen wherever life takes you.
            </p>
            <div className="platform-badges">
              <span>
                <Smartphone size={22} />
                <span>
                  iOS app<small>Coming soon</small>
                </span>
              </span>
              <span>
                <Smartphone size={22} />
                <span>
                  Android app<small>Coming soon</small>
                </span>
              </span>
            </div>
            <Link to="/signup" className="download-web-link">
              Start with the web app <ArrowRight size={16} />
            </Link>
          </div>
          <div
            className="phone-scene"
            aria-label="Concept preview of the future CdMento mobile app"
          >
            <span className="phone-orbit" />
            <span className="phone-spark">✦</span>
            <div className="phone-frame">
              <div className="phone-notch" />
              <PublicBrand />
              <span className="phone-greeting">Hey, curious mind.</span>
              <h3>
                A little progress
                <br />
                starts <em>here.</em>
              </h3>
              <div className="phone-subject">
                <span>
                  <BookOpen size={20} />
                </span>
                <div>
                  My learning space<small>Make room for your ideas</small>
                </div>
              </div>
              <div className="phone-tool-grid">
                <div>
                  <Layers />
                  Flashcards
                </div>
                <div>
                  <FileText />
                  Notes
                </div>
                <div>
                  <Network />
                  Mind maps
                </div>
                <div>
                  <Timer />
                  Focus
                </div>
              </div>
              <span className="phone-concept">MOBILE APP CONCEPT</span>
            </div>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <PublicBrand />
        <span>A little curiosity goes a long way.</span>
        <Link to="/">Back to home</Link>
        <small>© {new Date().getFullYear()} CdMento</small>
      </footer>
    </div>
  );
}

function ArrowUp() {
  return <ArrowRight size={15} className="diagonal-arrow" />;
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-site auth-site">
      <header className="public-header">
        <PublicBrand />
        <div className="public-header-actions">
          <ThemeToggle />
          <Link className="auth-back" to="/">
            <ArrowLeft size={15} /> Back to home
          </Link>
        </div>
      </header>
      <main className="auth-main">
        <section className="auth-form-column">{children}</section>
        <aside className="auth-story">
          <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
          <h2>
            A little curiosity.
            <br />A world of
            <br />
            <em>possibilities.</em>
          </h2>
          <p>
            A home for your notes, a rhythm for your practice, and a little more
            space to think.
          </p>
          <div className="auth-art">
            <div className="auth-art-card back-card" />
            <div className="auth-art-card">
              <span>
                <Sparkles size={20} /> A NOTE TO YOUR FUTURE SELF
              </span>
              <h3>You don’t have to learn it all today.</h3>
              <p>Just take the next small step.</p>
              <div>
                <span className="auth-check">
                  <Check size={16} />
                </span>
                Progress starts with showing up.
              </div>
            </div>
            <span className="auth-art-spark">✦</span>
          </div>
          <div className="auth-story-bottom">
            <span>
              <ShieldCheck size={16} /> Your own learning space
            </span>
            <span>
              <BookOpen size={16} /> Built around your materials
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}
const offlineMessage =
  "Account services are not connected yet. Please try again later.";
export function authError(error: unknown) {
  if (error instanceof ApiError && [401, 429].includes(error.status))
    return error.message;
  const code = (error as { code?: string })?.code;
  if (
    [
      "auth/invalid-credential",
      "auth/user-not-found",
      "auth/wrong-password",
    ].includes(code || "")
  )
    return "The email or password is incorrect. Please try again.";
  if (code === "auth/email-already-in-use")
    return "An account already uses this email. Try logging in or resetting your password.";
  if (code === "auth/too-many-requests")
    return "Too many attempts. Please wait a moment and try again.";
  if (code === "auth/network-request-failed")
    return "We couldn’t connect. Check your connection and try again.";
  if (
    code === "auth/expired-action-code" ||
    code === "auth/invalid-action-code"
  )
    return "This link has expired or has already been used. Please request a new one.";
  if (
    code === "auth/weak-password" ||
    code === "auth/password-does-not-meet-requirements"
  )
    return "Choose a stronger password that meets the account requirements.";
  if (error instanceof Error && error.message === offlineMessage)
    return offlineMessage;
  return "We couldn’t complete that request. Please try again.";
}
async function requireAccounts() {
  if (!firebaseAuth) throw new Error(offlineMessage);
  try {
    const health = await api("/health");
    if (health.auth_mode !== "firebase") throw new Error(offlineMessage);
  } catch {
    throw new Error(offlineMessage);
  }
  return firebaseAuth;
}
function PasswordField({
  id,
  value,
  onChange,
  label = "Password",
  autoComplete = "current-password",
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  autoComplete?: string;
  error?: string;
}) {
  const [visible, show] = useState(false);
  return (
    <label className="auth-label" htmlFor={id}>
      {label}
      <span className="password-wrap">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button
          type="button"
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          onClick={() => show(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {error && (
        <small id={`${id}-error`} className="auth-field-error">
          {error}
        </small>
      )}
    </label>
  );
}
export function AuthPage({ mode }: { mode: "login" | "signup" | "reset" }) {
  const { user: firebaseUser, demo, loading, loginDemo } = useSession();
  const user = firebaseUser || demo;
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const signup = mode === "signup",
    reset = mode === "reset";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState(false);
  useEffect(() => {
    if (firebaseAuth || mode !== "login") {
      setDemoAvailable(false);
      return;
    }
    let active = true;
    api("/health")
      .then((health) => {
        if (active)
          setDemoAvailable(
            health.auth_mode === "local" && !!health.demo_account_available,
          );
      })
      .catch(() => {
        if (active) setDemoAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [mode]);
  useEffect(() => {
    setError("");
    setFields({});
    setPassword("");
    setConfirm("");
    setSent(false);
    document.title = `${signup ? "Create your account" : reset ? "Reset your password" : "Welcome back"} — CdMento`;
  }, [mode]);
  if (!loading && user && !reset && !busy)
    return (
      <Navigate
        to={
          user.emailVerified
            ? next
            : `/verify-email?next=${encodeURIComponent(next)}`
        }
        replace
      />
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const issues: Record<string, string> = {};
    if (signup && !name.trim()) issues.name = "Enter your name.";
    if (signup && password.length < 8)
      issues.password = "Use at least 8 characters.";
    if (signup && password !== confirm)
      issues.confirm = "Your passwords don’t match.";
    setFields(issues);
    if (Object.keys(issues).length) return;
    setBusy(true);
    try {
      if (demoAvailable && !signup && !reset) {
        await loginDemo(email.trim(), password, remember);
        navigate(next, { replace: true });
        return;
      }
      const auth = await requireAccounts();
      if (reset) {
        try {
          await sendPasswordResetEmail(auth, email.trim(), {
            url: window.location.origin + "/login",
          });
        } catch (error) {
          if ((error as { code?: string }).code !== "auth/user-not-found")
            throw error;
        }
        setSent(true);
      } else {
        await setPersistence(
          auth,
          remember ? browserLocalPersistence : browserSessionPersistence,
        );
        if (signup) {
          const credential = await createUserWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          );
          await updateProfile(credential.user, { displayName: name.trim() });
          try {
            await sendEmailVerification(credential.user, {
              url: window.location.origin + "/verify-email",
            });
          } catch {
            /* The verification page can resend the email without repeating account creation. */
          }
          navigate(`/verify-email?next=${encodeURIComponent(next)}`, {
            replace: true,
          });
        } else {
          const credential = await signInWithEmailAndPassword(
            auth,
            email.trim(),
            password,
          );
          navigate(
            credential.user.emailVerified
              ? next
              : `/verify-email?next=${encodeURIComponent(next)}`,
            { replace: true },
          );
        }
      }
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  const suffix = `?next=${encodeURIComponent(next)}`;
  return (
    <AuthShell>
      <motion.div
        className="auth-form-inner"
        key={mode}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="auth-icon">
          {reset ? <Mail /> : signup ? <Sparkles /> : <BookOpen />}
        </span>
        <span className="eyebrow">
          {reset
            ? "LET’S GET YOU BACK IN"
            : signup
              ? "MAKE A LITTLE ROOM FOR LEARNING"
              : "GOOD TO HAVE YOU HERE"}
        </span>
        <h1>
          {reset
            ? "Forgot your password?"
            : signup
              ? "Your next chapter awaits."
              : "Welcome back,\ncurious mind."}
        </h1>
        <p className="auth-description">
          {reset
            ? "It happens. Enter your email and we’ll help you reset it."
            : signup
              ? "Create your own space to learn, practice, and grow."
              : "A fresh perspective is just a sign-in away."}
        </p>
        {sent ? (
          <div className="auth-success" role="status">
            <CheckCircle2 />
            <h3>Check your inbox.</h3>
            <p>
              If an account exists for {email}, you’ll receive a link to reset
              your password. Check your spam folder too.
            </p>
            <Link className="pub-button" to={`/login${suffix}`}>
              Back to log in <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="auth-form" key={location.pathname}>
            {!firebaseAuth && !demoAvailable && (
              <div className="auth-notice" role="status">
                Account services are not connected yet.
              </div>
            )}
            {demoAvailable && (
              <div className="auth-notice" role="status">
                Local demo account · your workspace is saved on this computer.
              </div>
            )}
            {signup && (
              <label className="auth-label" htmlFor="full-name">
                Your name
                <input
                  id="full-name"
                  name="name"
                  autoComplete="name"
                  placeholder="What should we call you?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                  aria-invalid={!!fields.name}
                />
                {fields.name && (
                  <small className="auth-field-error">{fields.name}</small>
                )}
              </label>
            )}
            <label className="auth-label" htmlFor="email">
              Email address
              <input
                id="email"
                name="email"
                autoComplete="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            {!reset && (
              <PasswordField
                id="password"
                value={password}
                onChange={setPassword}
                autoComplete={signup ? "new-password" : "current-password"}
                error={fields.password}
              />
            )}
            {signup && (
              <>
                <span className="password-help">
                  Make it yours. Use at least 8 characters.
                </span>
                <PasswordField
                  id="confirm-password"
                  label="Confirm password"
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                  error={fields.confirm}
                />
              </>
            )}
            {!reset && (
              <div className="auth-form-options">
                <label>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />{" "}
                  Keep me signed in
                </label>
                {!signup && (
                  <Link to={`/forgot-password${suffix}`}>Forgot password?</Link>
                )}
              </div>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="pub-button auth-submit"
              disabled={busy}
              type="submit"
            >
              {busy ? (
                <>
                  <LoaderCircle className="loading-spin" size={18} /> One
                  moment…
                </>
              ) : (
                <>
                  {reset
                    ? "Send reset link"
                    : signup
                      ? "Create my account"
                      : "Let’s get learning"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        )}
        <p className="auth-switch">
          {reset ? (
            <Link to={`/login${suffix}`}>
              <ArrowLeft size={14} /> Back to log in
            </Link>
          ) : signup ? (
            <>
              Already have an account?{" "}
              <Link to={`/login${suffix}`}>Log in</Link>
            </>
          ) : (
            <>
              New around here?{" "}
              <Link to={`/signup${suffix}`}>Create an account</Link>
            </>
          )}
        </p>
        <div className="auth-trust">
          <ShieldCheck size={15} /> A space that’s yours, from the very first
          note.
        </div>
      </motion.div>
    </AuthShell>
  );
}
export function VerifyPage() {
  const { user, loading, refresh, logout } = useSession();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  if (loading)
    return (
      <div className="public-site public-loading" role="status">
        Checking your account…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerified)
    return <Navigate to={safeNext(params.get("next"))} replace />;
  return (
    <AuthShell>
      <div className="auth-form-inner">
        <span className="auth-icon">
          <Mail />
        </span>
        <span className="eyebrow">ONE LITTLE STEP LEFT</span>
        <h1>Check your inbox.</h1>
        <p className="auth-description">
          Open the verification email sent to <strong>{user.email}</strong>,
          then come back here. Check your spam folder if you don’t see it.
        </p>
        <div className="auth-form">
          <button
            className="pub-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                await refresh();
                if (!firebaseAuth?.currentUser?.emailVerified)
                  setMessage(
                    "Your email hasn’t been verified yet. Open the link in your email first.",
                  );
              } catch (e) {
                setMessage(authError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            I’ve verified my email <ArrowRight size={17} />
          </button>
          <button
            className="pub-secondary"
            disabled={busy || !!cooldown}
            onClick={async () => {
              setBusy(true);
              try {
                await sendEmailVerification(user, {
                  url: window.location.origin + "/verify-email",
                });
                setCooldown(60);
                setMessage("Verification email sent. Please check your inbox.");
              } catch (e) {
                setMessage(authError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {cooldown ? `Resend in ${cooldown}s` : "Resend verification email"}
          </button>
          <p role="status" className="auth-description">
            {message}
          </p>
          <button
            className="auth-text-button"
            disabled={busy}
            onClick={() => logout().catch((e) => setMessage(authError(e)))}
          >
            Use a different account
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
export function ActionPage() {
  const [params] = useSearchParams();
  const mode = params.get("mode"),
    code = params.get("oobCode") || "";
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  const { refresh } = useSession();
  const valid = (mode === "verifyEmail" || mode === "resetPassword") && !!code;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (
      mode === "resetPassword" &&
      (password.length < 8 || password !== confirm)
    ) {
      setError("Use at least 8 characters and make sure your passwords match.");
      return;
    }
    setBusy(true);
    try {
      if (!firebaseAuth) throw new Error(offlineMessage);
      if (mode === "verifyEmail") {
        await applyActionCode(firebaseAuth, code);
        await refresh();
      } else {
        await verifyPasswordResetCode(firebaseAuth, code);
        await confirmPasswordReset(firebaseAuth, code, password);
      }
      setDone(true);
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell>
      <div className="auth-form-inner">
        <span className="auth-icon">
          <ShieldCheck />
        </span>
        <h1>
          {done
            ? "You’re all set."
            : !valid
              ? "This link isn’t valid."
              : mode === "verifyEmail"
                ? "Verify your email."
                : "A fresh start."}
        </h1>
        <p className="auth-description">
          {done
            ? "Your account has been updated. You can continue to CdMento."
            : !valid
              ? "Request a new link from the login or email verification page."
              : mode === "verifyEmail"
                ? "Confirm your email to open your own learning space."
                : "Choose a new password for your CdMento account."}
        </p>
        {done || !valid ? (
          <Link className="pub-button" to="/login">
            Continue to log in <ArrowRight size={17} />
          </Link>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            {mode === "resetPassword" && (
              <>
                <PasswordField
                  id="new-password"
                  label="New password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                />
                <PasswordField
                  id="confirm-new-password"
                  label="Confirm password"
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                />
              </>
            )}
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
            <button className="pub-button" disabled={busy}>
              {busy
                ? "One moment…"
                : mode === "verifyEmail"
                  ? "Verify my email"
                  : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
