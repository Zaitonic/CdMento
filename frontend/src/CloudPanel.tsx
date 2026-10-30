import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "./Session";
export default function CloudPanel({ close }: { close: () => void }) {
  const { user: firebaseUser, demo, logout } = useSession();
  const user = firebaseUser || demo;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal cloud-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Your account"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          aria-label="Close account"
          onClick={close}
        >
          <X />
        </button>
        <span className="tool-icon purple">
          <ShieldCheck />
        </span>
        <h2>{user?.displayName || "Your learning space"}</h2>
        <p>
          Signed in as {user?.email}. Your changes save automatically to your
          {demo ? "local demo workspace on this computer." : "account."}
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await logout();
              navigate("/", { replace: true });
            } catch {
              toast.error(
                "We could not save your latest changes. Try again before signing out.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <LogOut size={16} />
          {busy ? "Saving and signing out..." : "Sign out"}
        </button>
      </section>
    </div>
  );
}
