import { useEffect, useState, useRef } from "react";
import { Plus, Play, Pause, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { api, json } from "../../api";
import { useStore } from "../../store";

export default function Focus() {
  const [mode, setMode] = useState(25);
  const [seconds, setSeconds] = useState(1500);
  const [session, setSession] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const completing = useRef(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([api("/focus-sessions/current"), api("/tasks")])
      .then(([current, list]) => {
        if (cancelled) return;
        setTasks(list);
        if (current) {
          setSession(current);
          setMode(current.duration / 60);
          setSeconds(
            current.status === "paused"
              ? current.remaining
              : Math.max(
                  0,
                  Math.ceil((Date.parse(current.deadline) - Date.now()) / 1000),
                ),
          );
        }
      })
      .catch((e) => toast.error(e.message));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (session?.status !== "running") return;
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((Date.parse(session.deadline) - Date.now()) / 1000),
      );
      setSeconds(left);
      if (left === 0 && !completing.current) {
        completing.current = true;
        api(`/focus-sessions/${session.id}`, {
          method: "PATCH",
          body: json({ action: "complete" }),
        })
          .then(() => {
            setSession(null);
            toast.success("Session complete. Take a breath.");
            try {
              const audio = new Audio(
                "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUMAAA==",
              );
              audio.play().catch(() => {});
            } catch {}
          })
          .catch((e) => toast.error(e.message))
          .finally(() => {
            completing.current = false;
          });
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [session]);
  async function action(value: string) {
    if (!session) return;
    const result = await api(`/focus-sessions/${session.id}`, {
      method: "PATCH",
      body: json({ action: value }),
    });
    setSession(
      ["cancelled", "completed"].includes(result.status) ? null : result,
    );
    if (result.status === "paused") setSeconds(result.remaining);
  }
  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (session)
        await action(session.status === "running" ? "pause" : "resume");
      else
        setSession(
          await api("/focus-sessions", {
            method: "POST",
            body: json({
              duration: mode * 60,
              mode: mode === 25 ? "focus" : mode === 5 ? "short" : "long",
              notebook: useStore.getState().active || null,
            }),
          }),
        );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function reset(minutes = mode) {
    setBusy(true);
    try {
      if (session) await action("cancel");
      setMode(minutes);
      setSeconds(minutes * 60);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="feature-screen focus-screen">
      <div className="page-title">
        <span className="eyebrow">DEEP WORK / FOCUS ROOM</span>
        <h1>One thing at a time</h1>
        <p>
          A clear focus. A little progress. Your session stays with you after
          refresh.
        </p>
      </div>
      <div className="focus-layout">
        <div className="timer-card">
          <div className="timer-tabs">
            {[
              [25, "Focus"],
              [5, "Short break"],
              [15, "Long break"],
            ].map(([value, label]) => (
              <button
                key={value}
                disabled={busy}
                className={mode === value ? "active" : ""}
                onClick={() => reset(Number(value))}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="eyebrow">YOU’RE RIGHT WHERE YOU NEED TO BE</span>
          <div
            className="timer-orbit"
            style={
              {
                "--timer-progress": `${(1 - seconds / (mode * 60)) * 360}deg`,
              } as React.CSSProperties
            }
          >
            <div className="time">
              {String(Math.floor(seconds / 60)).padStart(2, "0")}
              <span>:</span>
              {String(seconds % 60).padStart(2, "0")}
            </div>
          </div>
          <div className="timer-actions">
            <button className="primary" disabled={busy} onClick={toggle}>
              {session?.status === "running" ? (
                <Pause size={18} />
              ) : (
                <Play size={18} />
              )}
              {session?.status === "running"
                ? "Pause session"
                : session
                  ? "Resume session"
                  : "Start session"}
            </button>
            <button
              className="secondary"
              disabled={busy}
              aria-label="Reset timer"
              onClick={() => reset()}
            >
              <RotateCcw size={18} />
            </button>
          </div>
          <p>Progress starts with showing up.</p>
        </div>
        <div className="task-card">
          <span className="eyebrow">SESSION CHECKLIST</span>
          <h2>A small plan for today</h2>
          <p className="task-summary">
            {tasks.filter((t) => t.done).length} of {tasks.length} tasks
            completed
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!task.trim()) return;
              try {
                const result = await api("/tasks", {
                  method: "POST",
                  body: json({ text: task.trim(), done: false }),
                });
                setTasks((old) => [...old, result]);
                setTask("");
              } catch (error: any) {
                toast.error(error.message);
              }
            }}
          >
            <input
              placeholder="What’s one thing to work on?"
              value={task}
              maxLength={500}
              onChange={(e) => setTask(e.target.value)}
            />
            <button className="icon-button" aria-label="Add task">
              <Plus size={19} />
            </button>
          </form>
          {tasks.map((t) => (
            <div className="task" key={t.id}>
              <label>
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={async () => {
                    try {
                      const result = await api(`/tasks/${t.id}`, {
                        method: "PATCH",
                        body: json({ text: t.text, done: !t.done }),
                      });
                      setTasks((old) =>
                        old.map((x) => (x.id === t.id ? result : x)),
                      );
                    } catch (e: any) {
                      toast.error(e.message);
                    }
                  }}
                />
                <span className={t.done ? "complete" : ""}>{t.text}</span>
              </label>
              <button
                className="icon-button"
                aria-label="Remove task"
                onClick={async () => {
                  try {
                    await api(`/tasks/${t.id}`, { method: "DELETE" });
                    setTasks((old) => old.filter((x) => x.id !== t.id));
                  } catch (e: any) {
                    toast.error(e.message);
                  }
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {!tasks.length && (
            <p className="muted">One small task is a good place to start.</p>
          )}
        </div>
      </div>
    </section>
  );
}
