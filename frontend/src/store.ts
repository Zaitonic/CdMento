import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { api, json } from "./api";

export type Notebook = {
  id: string;
  name: string;
  color: string;
  revision?: number;
};
export type Source = {
  id: string;
  notebook: string;
  name: string;
  text: string;
  type: string;
  date: string;
  status?: string;
  processing_page?: number | null;
  page_count?: number;
  ocr_pages?: number[];
  error?: string;
  revision?: number;
};
export type Note = {
  id: string;
  notebook: string;
  title: string;
  content: string;
  document?: object | null;
  revision?: number;
};
type Data = { notebooks: Notebook[]; sources: Source[]; notes: Note[] };
type State = Data & {
  active: string;
  dark: boolean;
  ready: boolean;
  owner: string;
  sync: string;
  pendingImport: Data | null;
  recovery: Data | null;
  restoreRecovery: () => void;
  selectedSources: string[] | null;
  selectSources: (ids: string[] | null) => void;
  set: (data: Partial<Data & { active: string; dark: boolean }>) => void;
  initialize: () => Promise<void>;
  clearSession: () => void;
  refresh: () => Promise<void>;
  flush: () => Promise<void>;
  importLocal: () => Promise<void>;
};
let confirmed: Data = { notebooks: [], sources: [], notes: [] };
let running: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout>;
let generation = 0;
const ACTIVE_NOTEBOOK_PREFIX = "cdmento-active-notebook:";
export function activeNotebookKey(owner: string) {
  return ACTIVE_NOTEBOOK_PREFIX + encodeURIComponent(owner);
}
export function readActiveNotebook(owner: string) {
  try {
    return localStorage.getItem(activeNotebookKey(owner)) || "";
  } catch {
    return "";
  }
}
function rememberActiveNotebook(owner: string, id: string) {
  if (!owner) return;
  try {
    if (id) localStorage.setItem(activeNotebookKey(owner), id);
    else localStorage.removeItem(activeNotebookKey(owner));
  } catch {
    // The selection still works for this session when storage is unavailable.
  }
}
export function resolveActiveNotebook(
  notebooks: Notebook[],
  saved: string,
): string {
  return notebooks.some((notebook) => notebook.id === saved)
    ? saved
    : notebooks[0]?.id || "";
}
type Cache = Pick<
  State,
  "notebooks" | "sources" | "notes" | "active" | "dark" | "sync"
>;
const contentKeys = (kind: keyof Data, item: any) =>
  kind === "notebooks"
    ? { id: item.id, name: item.name, color: item.color }
    : kind === "notes"
      ? {
          id: item.id,
          title: item.title,
          content: item.content,
          document: item.document || null,
        }
      : { name: item.name };
const equal = (kind: keyof Data, a: any, b: any) =>
  json(contentKeys(kind, a)) === json(contentKeys(kind, b));

async function saveChanges(): Promise<void> {
  if (timer) clearTimeout(timer);
  if (running) {
    await running;
    return saveChanges();
  }
  if (!useStore.getState().ready)
    throw new Error("Connect to the backend before changing this workspace.");
  const epoch = generation;
  running = (async () => {
    useStore.setState({ sync: "Saving…" });
    for (;;) {
      if (epoch !== generation) return;
      const state = useStore.getState();
      let changed = false;
      for (const kind of ["notes", "sources", "notebooks"] as const) {
        const removed = confirmed[kind].filter(
          (item) => !state[kind].some((x) => x.id === item.id),
        );
        for (const item of removed) {
          try {
            await api(`/${kind}/${item.id}`, { method: "DELETE" });
          } catch (e: any) {
            if (e.status !== 404) throw e;
          }
          if (epoch !== generation) return;
          (confirmed[kind] as any[]) = confirmed[kind].filter(
            (x) => x.id !== item.id,
          );
          changed = true;
        }
      }
      for (const kind of ["notebooks", "notes", "sources"] as const) {
        for (const item of state[kind]) {
          const previous = confirmed[kind].find((x) => x.id === item.id);
          if (previous && equal(kind, previous, item)) continue;
          if (kind === "sources" && !previous) continue;
          const path = previous
            ? `/${kind}/${item.id}`
            : kind === "notes"
              ? `/notebooks/${(item as Note).notebook}/notes`
              : "/notebooks";
          const body = {
            ...contentKeys(kind, item),
            ...(kind === "notes" && previous
              ? { revision: previous.revision }
              : {}),
          };
          const result = await api(path, {
            method: previous ? "PATCH" : "POST",
            body: json(body),
          });
          if (epoch !== generation) return;
          (confirmed[kind] as any[]) = [
            ...confirmed[kind].filter((x) => x.id !== item.id),
            result,
          ];
          changed = true;
        }
      }
      const latest = useStore.getState();
      if (
        !changed ||
        (["notebooks", "sources", "notes"] as const).every(
          (kind) =>
            latest[kind].length === confirmed[kind].length &&
            latest[kind].every((item) => {
              const other = confirmed[kind].find((x) => x.id === item.id);
              return other && equal(kind, item, other);
            }),
        )
      )
        break;
    }
    if (epoch === generation) useStore.setState({ sync: "Saved" });
  })();
  try {
    await running;
  } catch (error) {
    if (epoch === generation) useStore.setState({ sync: "Save failed" });
    throw error;
  } finally {
    running = null;
  }
}

export const useStore = create(
  persist<State, [], [], Cache>(
    (set, get) => ({
      notebooks: [],
      sources: [],
      notes: [],
      active: "",
      dark: false,
      ready: false,
      owner: "",
      sync: "Connecting…",
      pendingImport: null,
      recovery: null,
      clearSession: () => {
        generation++;
        clearTimeout(timer);
        const state = get();
        const previousOwner =
          state.owner || localStorage.getItem("cdmento-server-identity");
        if (previousOwner && state.sync !== "Saved" && state.notes.length)
          localStorage.setItem(
            "cdmento-unsaved-" + previousOwner,
            json({
              notebooks: state.notebooks,
              sources: [],
              notes: state.notes,
            }),
          );
        if (
          !previousOwner &&
          state.notebooks.length &&
          !localStorage.getItem("cdmento-legacy-backup")
        )
          localStorage.setItem(
            "cdmento-legacy-backup",
            json({
              notebooks: state.notebooks,
              sources: state.sources,
              notes: state.notes,
            }),
          );
        confirmed = { notebooks: [], sources: [], notes: [] };
        set({
          notebooks: [],
          sources: [],
          notes: [],
          active: "",
          owner: "",
          ready: false,
          sync: "Connecting…",
          selectedSources: null,
          pendingImport: null,
          recovery: null,
        });
      },
      restoreRecovery: () => {
        const data = get().recovery;
        if (!data) return;
        const notebooks = [
          ...get().notebooks,
          ...data.notebooks.filter(
            (n) => !get().notebooks.some((existing) => existing.id === n.id),
          ),
        ];
        get().set({
          notebooks,
          notes: [
            ...get().notes,
            ...data.notes.map((n) => ({
              ...n,
              id: crypto.randomUUID(),
              title: n.title + " (recovered)",
              revision: undefined,
            })),
          ],
        });
        const owner = localStorage.getItem("cdmento-server-identity");
        if (owner) localStorage.removeItem("cdmento-unsaved-" + owner);
        set({ recovery: null });
      },
      selectedSources: null,
      selectSources: (ids) => set({ selectedSources: ids }),
      set: (data) => {
        if (!get().ready && (data.notebooks || data.sources || data.notes)) {
          toast.error("Wait for the backend connection.");
          return;
        }
        set({
          ...data,
          ...(data.active !== undefined && data.active !== get().active
            ? { selectedSources: null }
            : {}),
        });
        if (data.active !== undefined)
          rememberActiveNotebook(get().owner, data.active);
        if (data.notebooks || data.sources || data.notes) {
          set({ sync: "Unsaved changes" });
          clearTimeout(timer);
          timer = setTimeout(
            () => saveChanges().catch((e) => toast.error(e.message)),
            600,
          );
        }
      },
      initialize: async () => {
        generation++;
        const epoch = generation;
        clearTimeout(timer);
        const local = {
          notebooks: get().notebooks,
          sources: get().sources,
          notes: get().notes,
        };
        const previousIdentity = localStorage.getItem(
          "cdmento-server-identity",
        );
        if (previousIdentity && local.notes.length && get().sync !== "Saved")
          localStorage.setItem(
            "cdmento-unsaved-" + previousIdentity,
            json(local),
          );
        if (
          local.notebooks.length &&
          !previousIdentity &&
          !localStorage.getItem("cdmento-legacy-backup")
        )
          localStorage.setItem("cdmento-legacy-backup", json(local));
        set({
          ready: false,
          owner: "",
          sync: "Connecting…",
          notebooks: [],
          sources: [],
          notes: [],
          active: "",
        });
        try {
          const me = await api("/me");
          if (epoch !== generation) return;
          const data = await api<Data>("/workspace");
          if (epoch !== generation) return;
          confirmed = structuredClone(data);
          localStorage.setItem("cdmento-server-identity", me.id);
          const backup = localStorage.getItem("cdmento-legacy-backup");
          const recoveryKey = "cdmento-unsaved-" + me.id;
          let recovery = JSON.parse(
            localStorage.getItem(recoveryKey) || "null",
          ) as Data | null;
          if (recovery) {
            recovery.notes = recovery.notes.filter((note) => {
              const saved = data.notes.find((n) => n.id === note.id);
              return !saved || !equal("notes", note, saved);
            });
            if (!recovery.notes.length) {
              recovery = null;
              localStorage.removeItem(recoveryKey);
            }
          }
          const active = resolveActiveNotebook(
            data.notebooks,
            readActiveNotebook(me.id),
          );
          rememberActiveNotebook(me.id, active);
          set({
            ...data,
            active,
            ready: true,
            owner: me.id,
            sync: "Saved",
            selectedSources: null,
            recovery,
            pendingImport:
              backup && localStorage.getItem("cdmento-imported-by") !== me.id
                ? JSON.parse(backup)
                : null,
          });
        } catch (error: any) {
          if (epoch === generation) set({ ready: false, sync: error.message });
        }
      },
      flush: saveChanges,
      refresh: async () => {
        const epoch = generation;
        await saveChanges();
        const data = await api<Data>("/workspace");
        if (epoch !== generation) return;
        confirmed = structuredClone(data);
        const active = resolveActiveNotebook(data.notebooks, get().active);
        rememberActiveNotebook(get().owner, active);
        set({ ...data, active });
      },
      importLocal: async () => {
        const backup = get().pendingImport;
        if (!backup) return;
        await saveChanges();
        await api("/workspace/import", { method: "POST", body: json(backup) });
        localStorage.setItem(
          "cdmento-imported-by",
          localStorage.getItem("cdmento-server-identity") || "",
        );
        set({ pendingImport: null });
        await get().refresh();
        toast.success("Your existing notebooks were imported.");
      },
    }),
    {
      name: "cdmento-workspace-v1",
      version: 2,
      partialize: (state) => ({
        notebooks: state.notebooks,
        // Server-owned source text is never duplicated into quota-limited localStorage.
        sources: [],
        notes:
          state.sync === "Saved"
            ? []
            : state.notes.filter((note) => {
                const saved = confirmed.notes.find((n) => n.id === note.id);
                return !saved || !equal("notes", note, saved);
              }),
        active: state.active,
        dark: state.dark,
        sync: state.sync,
      }),
      migrate: (value: any) => ({
        ...value,
        ready: false,
        sync: "Connecting…",
        pendingImport: null,
      }),
    },
  ),
);
