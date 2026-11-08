import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Moon, Sun } from "lucide-react";
import { flushSync } from "react-dom";
type Theme = "light" | "dark";
const KEY = "cdmento-public-theme";
const ThemeContext = createContext({
  theme: "light" as Theme,
  toggle: () => {},
});
export const usePublicTheme = () => useContext(ThemeContext);
export function PublicThemeProvider({ children }: { children: ReactNode }) {
  const activeTransition = useRef<ViewTransition | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.publicTheme = theme;
    document
      .querySelector('link[rel="icon"]')
      ?.setAttribute("href", "/brand/cdmento-favicon.svg");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#111517" : "#fcfbf8");
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* Theme still works when browser storage is unavailable. */
    }
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (
        event.key === KEY &&
        (event.newValue === "light" || event.newValue === "dark")
      )
        setTheme(event.newValue);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    activeTransition.current?.skipTransition();
    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setTheme(next);
      return;
    }
    document.documentElement.classList.add("public-theme-transition");
    const transition = document.startViewTransition(() => {
      flushSync(() => setTheme(next));
    });
    activeTransition.current = transition;
    transition.finished
      .catch(() => {})
      .finally(() => {
        if (activeTransition.current !== transition) return;
        activeTransition.current = null;
        document.documentElement.classList.remove("public-theme-transition");
      });
  }
  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggle,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeToggle() {
  const { theme, toggle } = usePublicTheme();
  return (
    <button
      className="public-theme-toggle"
      type="button"
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      aria-pressed={theme === "dark"}
      onClick={toggle}
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
      <span>{theme === "light" ? "Dark" : "Light"}</span>
    </button>
  );
}
