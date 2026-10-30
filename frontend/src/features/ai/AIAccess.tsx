import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { useStore } from "../../store";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";

export type AIStatus = {
  configured: boolean;
  state?: "ready" | "cooling_down" | "disabled" | "unconfigured";
  automatic?: boolean;
  free_only: boolean;
  message: string;
  retry_at?: number | null;
  approved_providers?: string[];
  providers: {
    name: string;
    model: string;
    requests_used: number;
    daily_cap: number;
    retry_at?: number;
    disabled: boolean;
  }[];
};

export function useAI() {
  const owner = useStore((s) => s.owner);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((v) => v + 1), []);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    window.addEventListener("cdmento-ai-changed", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("cdmento-ai-changed", refresh);
    };
  }, [refresh]);
  useEffect(() => {
    setStatus(null);
    setError("");
    setLoading(true);
  }, [owner]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<AIStatus>("/ai/status")
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch((e: any) => {
        if (active) {
          setStatus(null);
          setError(
            e?.message ||
              "AI connection status is unavailable. Refresh to retry.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [owner, refreshVersion]);
  const now = Date.now() / 1000;
  const anyUsable = (status?.providers || []).some(
    (p) =>
      !p.disabled &&
      p.requests_used < p.daily_cap &&
      !((p.retry_at || 0) > now),
  );
  return {
    status,
    error,
    loading,
    refresh,
    // The gateway chooses providers automatically and falls through to the
    // next one when a free quota runs out. Users never pick or approve one.
    ready:
      !loading &&
      !!status?.configured &&
      (status.state ? status.state === "ready" : anyUsable),
  };
}

export type AIAccessState = ReturnType<typeof useAI>;

export function AIAccess({ ai }: { ai: AIAccessState }) {
  if (ai.loading)
    return (
      <p className="ai-status-note" role="status">
        <Loader2 size={14} className="spin" />
        Checking AI connection…
      </p>
    );
  if (ai.error)
    return (
      <p className="ai-status-note field-error" role="alert">
        <WifiOff size={14} />
        {ai.error}{" "}
        <button className="text-button" onClick={ai.refresh}>
          Retry
        </button>
      </p>
    );
  if (!ai.status || !ai.status.configured)
    return (
      <p className="ai-status-note">
        AI isn’t connected on this server yet. Uploading, extracting, and reading
        documents stays local.
      </p>
    );
  if (ai.status.state === "cooling_down")
    return (
      <p className="ai-status-note" role="status">
        Free-tier AI has used its current quota. Your work is saved and requests
        continue automatically when a provider becomes available.{" "}
        <button className="text-button" onClick={ai.refresh}>
          <RefreshCw size={12} /> Check again
        </button>
      </p>
    );
  if (ai.status.state === "disabled")
    return (
      <p className="ai-status-note field-error" role="status">
        The AI providers need attention. Check the server keys and provider
        access.{" "}
        <button className="text-button" onClick={ai.refresh}>
          <RefreshCw size={12} /> Check again
        </button>
      </p>
    );
  return null;
}
