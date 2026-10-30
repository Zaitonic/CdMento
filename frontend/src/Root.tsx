import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { SessionProvider, useSession } from "./Session";
import {
  Landing,
  GetAppPage,
  AuthPage,
  VerifyPage,
  ActionPage,
  PublicBrand,
} from "./PublicPages";
import { api } from "./api";
import { safeNext } from "./paths";
import { PublicThemeProvider } from "./PublicTheme";
import "./style.css";
import "./public.css";
import "./public-theme.css";
import "./light-typography.css";
const Workspace = lazy(() => import("./App"));

function ProtectedWorkspace() {
  const { user: firebaseUser, demo, loading } = useSession();
  const user = firebaseUser || demo;
  const location = useLocation();
  const [connection, setConnection] = useState("checking");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!user?.emailVerified) return;
    let active = true;
    setConnection("checking");
    api("/health")
      .then((health) => {
        if (active)
          setConnection(
            (health.auth_mode === "firebase" && firebaseUser) ||
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
      });
    return () => {
      active = false;
    };
  }, [user?.uid, user?.emailVerified, attempt, !!demo]);
  if (loading)
    return (
      <div className="public-site public-loading" role="status">
        Opening CdMento…
      </div>
    );
  const next = encodeURIComponent(
    safeNext(location.pathname + location.search),
  );
  if (!user) return <Navigate to={`/login?next=${next}`} replace />;
  if (!user.emailVerified)
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
    <Suspense
      fallback={
        <div className="public-site public-loading" role="status">
          Opening your workspace…
        </div>
      }
    >
      <Workspace />
    </Suspense>
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
          <Toaster richColors position="bottom-right" />
        </SessionProvider>
      </PublicThemeProvider>
    </MotionConfig>
  );
}
