import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { SessionProvider, useSession } from "./lib/Session";
import {
  Landing,
  GetAppPage,
  AuthPage,
  VerifyPage,
  ActionPage,
  PublicBrand,
} from "./public/PublicPages";
import { api } from "./lib/api";
import { safeNext } from "./lib/paths";
import { PublicThemeProvider } from "./public/PublicTheme";
import "./style.css";
import "./public/public.css";
import "./public/public-theme.css";
import "./public/light-typography.css";
const Workspace = lazy(() => import("./App"));

type WorkspaceBoundaryState = { error: Error | null };

class WorkspaceErrorBoundary extends Component<
  { children: ReactNode },
  WorkspaceBoundaryState
> {
  state: WorkspaceBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WorkspaceBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Workspace failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="public-site public-loading" role="alert">
          <PublicBrand />
          <h1>We couldn’t open this workspace.</h1>
          <p>
            The page loaded, but one workspace component failed. Reload to
            recover the latest version.
          </p>
          <button
            className="pub-button"
            onClick={() => window.location.reload()}
          >
            Reload workspace
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedWorkspace() {
  const { user, demo, provider, loading } = useSession();
  const accountUser = user || demo;
  const location = useLocation();
  const [connection, setConnection] = useState("checking");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!accountUser?.emailVerified) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    setConnection("checking");
    api("/health", { signal: controller.signal })
      .then((health) => {
        if (active)
          setConnection(
            (health.auth_mode === "firebase" && provider === "firebase" && user) ||
              (health.auth_mode === "google" && provider === "google" && user) ||
              (health.auth_mode === "google" && provider === "password" && user) ||
              (health.auth_mode === "local" && demo)
              ? "ready"
              : "Account services are not connected yet. Please try again later.",
          );
      })
      .catch(() => {
        if (active)
          setConnection(
            "We couldn’t connect to your workspace. Please try again.",
          );
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [accountUser?.uid, accountUser?.emailVerified, attempt, !!demo, provider]);
  if (loading)
    return (
      <div className="public-site public-loading" role="status">
        Opening CdMento…
      </div>
    );
  const next = encodeURIComponent(
    safeNext(location.pathname + location.search),
  );
  if (!accountUser) return <Navigate to={`/login?next=${next}`} replace />;
  if (!accountUser.emailVerified)
    return <Navigate to={`/verify-email?next=${next}`} replace />;
  if (connection !== "ready")
    return (
      <div className="public-site public-loading">
        <PublicBrand />
        <p role="status">
          {connection === "checking"
            ? "Connecting to your workspace…"
            : connection}
        </p>
        {connection !== "checking" && (
          <button className="pub-button" onClick={() => retry((n) => n + 1)}>
            Try again
          </button>
        )}
      </div>
    );
  return (
    <WorkspaceErrorBoundary>
      <Suspense
        fallback={
          <div className="public-site public-loading" role="status">
            Opening your workspace…
          </div>
        }
      >
        <Workspace />
      </Suspense>
    </WorkspaceErrorBoundary>
  );
}
export default function Root() {
  return (
    <MotionConfig reducedMotion="user">
      <PublicThemeProvider>
        <SessionProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/get-app" element={<GetAppPage />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route
              path="/forgot-password"
              element={<AuthPage mode="reset" />}
            />
            <Route path="/verify-email" element={<VerifyPage />} />
            <Route path="/auth/action" element={<ActionPage />} />
            <Route path="*" element={<ProtectedWorkspace />} />
          </Routes>
          <Toaster richColors position="top-right" offset="88px" />
        </SessionProvider>
      </PublicThemeProvider>
    </MotionConfig>
  );
}
