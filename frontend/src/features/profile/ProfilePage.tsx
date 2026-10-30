import { useEffect, useState } from "react";
import { BookOpen, LogOut, Save, Sparkles } from "lucide-react";
import { useSession, avatarSymbols } from "../../Session";
import { useStore } from "../../store";
import "./profile.css";

const colors = ["purple", "blue", "green", "orange", "pink"];
export default function ProfilePage() {
  const session = useSession();
  const store = useStore();
  const [draft, setDraft] = useState(session.account);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(session.account);
  }, [session.account]);
  if (!draft)
    return (
      <section className="profile-page">
        <h1>Your profile</h1>
        <p role="status">{session.accountError || "Loading your profile…"}</p>
        {session.accountError && (
          <button className="secondary" onClick={session.refreshAccount}>
            Retry
          </button>
        )}
      </section>
    );
  const change = (key: string, value: string) => {
    setDraft({ ...draft, [key]: value });
    setSaved(false);
  };
  const symbol =
    avatarSymbols[draft.avatar] ||
    draft.display_name.charAt(0).toUpperCase() ||
    "S";
  return (
    <section className="profile-page">
      <div className="profile-page-heading">
        <span className="eyebrow">YOUR LEARNING IDENTITY</span>
        <h1>A little more you.</h1>
        <p>Make your CdMento space feel like your own.</p>
      </div>
      <div className="profile-grid">
        <aside className="profile-preview">
          <div className="profile-cover">
            <Sparkles size={26} />
          </div>
          <div
            className={`profile-large-avatar account-avatar avatar-${draft.color}`}
          >
            {symbol}
          </div>
          <h2>{draft.display_name || "Your name"}</h2>
          <p className="profile-email">
            {draft.email || session.user?.email || session.demo?.email}
          </p>
          <p className="profile-bio">
            {draft.bio || "A curious mind. A new chapter."}
          </p>
          {draft.study_goal && (
            <div className="profile-goal">
              <BookOpen size={18} />
              <span>{draft.study_goal}</span>
            </div>
          )}
          <div className="profile-stats">
            <div>
              <b>{store.notebooks.length}</b>
              <span>Notebooks</span>
            </div>
            <div>
              <b>{store.notes.length}</b>
              <span>Notes</span>
            </div>
            <div>
              <b>{store.sources.length}</b>
              <span>Sources</span>
            </div>
          </div>
          <small>Only visible in your account</small>
        </aside>
        <form
          className="profile-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError("");
            setSaved(false);
            try {
              await session.saveAccount({
                display_name: draft.display_name.trim(),
                bio: draft.bio,
                study_goal: draft.study_goal,
                avatar: draft.avatar,
                color: draft.color,
              });
              setSaved(true);
            } catch (error: any) {
              setError(
                error.message || "Could not save your profile. Please retry.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <h2>Edit profile</h2>
          <p>Your details, your personality, your next goal.</p>
          <fieldset disabled={saving}>
            <legend>Choose your avatar</legend>
            <div className="profile-avatar-options">
              {["initials", ...Object.keys(avatarSymbols)].map((avatar) => (
                <button
                  key={avatar}
                  type="button"
                  aria-label={`${avatar} avatar`}
                  aria-pressed={draft.avatar === avatar}
                  onClick={() => change("avatar", avatar)}
                >
                  {avatarSymbols[avatar] ||
                    draft.display_name.charAt(0).toUpperCase() ||
                    "S"}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={saving}>
            <legend>Avatar color</legend>
            <div className="profile-color-options">
              {colors.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={`account-avatar avatar-${color}`}
                  aria-label={`${color} color`}
                  aria-pressed={draft.color === color}
                  onClick={() => change("color", color)}
                >
                  {draft.color === color ? "✓" : ""}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            Display name
            <input
              required
              maxLength={80}
              value={draft.display_name}
              disabled={saving}
              onChange={(e) => change("display_name", e.target.value)}
              autoComplete="nickname"
            />
          </label>
          <label>
            Bio
            <textarea
              maxLength={300}
              rows={3}
              disabled={saving}
              value={draft.bio}
              placeholder="What are you curious about?"
              onChange={(e) => change("bio", e.target.value)}
            />
            <small>{draft.bio.length}/300</small>
          </label>
          <label>
            Study goal
            <input
              maxLength={160}
              disabled={saving}
              value={draft.study_goal}
              placeholder="e.g. Learn JavaScript, one concept at a time"
              onChange={(e) => change("study_goal", e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="profile-success">
              Profile saved. Looking good!
            </p>
          )}
          <div className="profile-form-actions">
            <button
              className="primary"
              disabled={saving || !draft.display_name.trim()}
            >
              <Save size={16} />
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => {
                setDraft(session.account);
                setSaved(false);
                setError("");
              }}
            >
              Reset changes
            </button>
          </div>
        </form>
      </div>
      <div className="profile-account">
        <div>
          <h2>Account</h2>
          <p>
            {session.demo
              ? "You’re using the local demo account."
              : "You’re signed in with your verified account."}
          </p>
        </div>
        <button
          className="secondary"
          disabled={leaving || saving}
          onClick={async () => {
            setLeaving(true);
            try {
              await session.logout();
            } catch (e: any) {
              setError(e.message);
              setLeaving(false);
            }
          }}
        >
          <LogOut size={16} />
          {leaving ? "Logging out…" : "Log out"}
        </button>
      </div>
    </section>
  );
}
