import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { onIdTokenChanged, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "./auth";
import { api, json, setToken } from "./api";
import { useStore } from "./store";

export type AccountProfile = {
  display_name: string;
  email: string;
  bio: string;
  study_goal: string;
  avatar: string;
  color: string;
};
export const avatarSymbols: Record<string, string> = {
  book: "📚",
  spark: "✨",
  plant: "🌱",
  rocket: "🚀",
  cat: "🐱",
};
type DemoProfile = {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: true;
  kind: "local-demo";
};
const DEMO_KEY = "cdmento-demo-token";
function savedDemoToken() {
  try {
    return (
      sessionStorage.getItem(DEMO_KEY) || localStorage.getItem(DEMO_KEY) || ""
    );
  } catch {
    return "";
  }
}
function clearDemoStorage() {
  try {
    sessionStorage.removeItem(DEMO_KEY);
    localStorage.removeItem(DEMO_KEY);
  } catch {
    /* Storage can be disabled. */
  }
}
const Session = createContext({
  user: null as User | null,
  demo: null as DemoProfile | null,
  loading: true,
  account: null as AccountProfile | null,
  accountError: "",
  refresh: async () => {},
  logout: async () => {},
  refreshAccount: async () => {},
  saveAccount: async (_profile: Omit<AccountProfile, "email">) => {},
  loginDemo: async (
    _email: string,
    _password: string,
    _remember: boolean,
  ) => {},
});
export const useSession = () => useContext(Session);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [demo, setDemo] = useState<DemoProfile | null>(null);
  const [loading, setLoading] = useState(!!firebaseAuth || !!savedDemoToken());
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [accountError, setAccountError] = useState("");
  const demoVersion = useRef(0);
  const [, render] = useState(0);
  const identity = user?.uid || demo?.uid;
  useEffect(() => {
    let active = true;
    setAccount(null);
    setAccountError("");
    if (identity)
      api<AccountProfile>("/me/profile")
        .then((data) => {
          if (active) setAccount(data);
        })
        .catch(() => {
          if (active)
            setAccountError("Could not load your profile. Please retry.");
        });
    return () => {
      active = false;
    };
  }, [identity]);
  async function refreshAccount() {
    try {
      setAccount(await api<AccountProfile>("/me/profile"));
      setAccountError("");
    } catch {
      setAccountError("Could not load your profile. Please retry.");
    }
  }
  async function saveAccount(profile: Omit<AccountProfile, "email">) {
    setAccount(
      await api<AccountProfile>("/me/profile", {
        method: "PATCH",
        body: json(profile),
      }),
    );
  }
  useEffect(() => {
    if (!firebaseAuth) {
      const token = savedDemoToken();
      if (!token) {
        setLoading(false);
        return;
      }
      let active = true;
      const epoch = ++demoVersion.current;
      setToken(token);
      api<DemoProfile>("/auth/demo/session")
        .then((profile) => {
          if (!active || epoch !== demoVersion.current) return;
          if (useStore.getState().owner !== profile.uid)
            useStore.getState().clearSession();
          setDemo(profile);
        })
        .catch(() => {
          if (!active || epoch !== demoVersion.current) return;
          clearDemoStorage();
          setToken("");
          setDemo(null);
          useStore.getState().clearSession();
        })
        .finally(() => {
          if (active && epoch === demoVersion.current) setLoading(false);
        });
      return () => {
        active = false;
      };
    }
    let active = true;
    let version = 0;
    const unsubscribe = onIdTokenChanged(firebaseAuth, async (current) => {
      const epoch = ++version;
      try {
        const token = current ? await current.getIdToken() : "";
        if (!active || epoch !== version) return;
        if (useStore.getState().owner !== current?.uid)
          useStore.getState().clearSession();
        setToken(token);
        setUser(current);
        render((n) => n + 1);
      } catch {
        if (!active || epoch !== version) return;
        setToken("");
        setUser(null);
        useStore.getState().clearSession();
      } finally {
        if (active && epoch === version) setLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function refresh() {
    if (demo) {
      setDemo(await api<DemoProfile>("/auth/demo/session"));
      return;
    }
    if (!firebaseAuth?.currentUser) return;
    await firebaseAuth.currentUser.reload();
    setToken(await firebaseAuth.currentUser.getIdToken(true));
    setUser(firebaseAuth.currentUser);
    render((n) => n + 1);
  }
  async function logout() {
    if (useStore.getState().ready) await useStore.getState().flush();
    if (demo) {
      await api("/auth/demo/logout", { method: "POST" });
      demoVersion.current++;
      clearDemoStorage();
      setDemo(null);
    } else if (firebaseAuth) await signOut(firebaseAuth);
    setToken("");
    useStore.getState().clearSession();
    setUser(null);
    setAccount(null);
    window.location.href = "/";
  }
  async function loginDemo(email: string, password: string, remember: boolean) {
    if (firebaseAuth)
      throw new Error("Local demo sign-in is unavailable in cloud mode.");
    const epoch = ++demoVersion.current;
    const result = await api<{ token: string; profile: DemoProfile }>(
      "/auth/demo/login",
      { method: "POST", body: json({ email, password }) },
    );
    if (epoch !== demoVersion.current) return;
    useStore.getState().clearSession();
    clearDemoStorage();
    try {
      (remember ? localStorage : sessionStorage).setItem(
        DEMO_KEY,
        result.token,
      );
    } catch {
      /* Current-session sign-in works without storage. */
    }
    setToken(result.token);
    setDemo(result.profile);
    setLoading(false);
  }
  return (
    <Session.Provider
      value={{
        user,
        demo,
        loading,
        refresh,
        logout,
        loginDemo,
        account,
        accountError,
        saveAccount,
        refreshAccount,
      }}
    >
      {children}
    </Session.Provider>
  );
}
