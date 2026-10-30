import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionProvider, useSession } from "./Session";
import { api, setToken } from "./api";
import { useStore } from "./store";
vi.mock("./auth", () => ({ firebaseAuth: null }));
vi.mock("./api", () => ({
  api: vi.fn(),
  setToken: vi.fn(),
  json: JSON.stringify,
}));
const profile = {
  uid: "demo-student",
  email: "demo@example.com",
  displayName: "Demo Student",
  emailVerified: true,
  kind: "local-demo",
};
function Probe() {
  const { demo, loading, loginDemo, logout } = useSession();
  return (
    <>
      <p>
        {loading
          ? "Restoring session"
          : demo
            ? `Signed in as ${demo.email}`
            : "Signed out"}
      </p>
      <button
        onClick={() =>
          loginDemo("demo@example.com", "test-only-password", false)
        }
      >
        Demo login
      </button>
      <button onClick={() => logout()}>Demo logout</button>
    </>
  );
}
beforeEach(() => {
  useStore.getState().clearSession();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
describe("local demo sessions", () => {
  it("signs in with a server token and revokes it on logout", async () => {
    vi.mocked(api).mockImplementation(async (path) =>
      path === "/auth/demo/login"
        ? { token: "demo_test-token", profile }
        : undefined,
    );
    const user = userEvent.setup();
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Demo login" }));
    expect(
      await screen.findByText("Signed in as demo@example.com"),
    ).toBeTruthy();
    expect(setToken).toHaveBeenCalledWith("demo_test-token");
    expect(sessionStorage.getItem("cdmento-demo-token")).toBe(
      "demo_test-token",
    );
    expect(localStorage.getItem("cdmento-demo-token")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Demo logout" }));
    expect(await screen.findByText("Signed out")).toBeTruthy();
    expect(api).toHaveBeenCalledWith("/auth/demo/logout", { method: "POST" });
    expect(sessionStorage.getItem("cdmento-demo-token")).toBeNull();
  });
  it("restores a remembered demo only after the backend validates the session", async () => {
    localStorage.setItem("cdmento-demo-token", "demo_saved-token");
    vi.mocked(api).mockResolvedValue(profile);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    expect(
      await screen.findByText("Signed in as demo@example.com"),
    ).toBeTruthy();
    expect(api).toHaveBeenCalledWith("/auth/demo/session");
    expect(setToken).toHaveBeenCalledWith("demo_saved-token");
  });
  it("clears expired sessions and cached workspace metadata", async () => {
    localStorage.setItem("cdmento-demo-token", "demo_expired-token");
    useStore.setState({
      owner: "demo-student",
      notebooks: [{ id: "cached", name: "Old notebook", color: "purple" }],
    });
    vi.mocked(api).mockRejectedValue(new Error("Session expired"));
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    expect(await screen.findByText("Signed out")).toBeTruthy();
    await waitFor(() =>
      expect(localStorage.getItem("cdmento-demo-token")).toBeNull(),
    );
    expect(useStore.getState().notebooks).toEqual([]);
    expect(setToken).toHaveBeenLastCalledWith("");
  });
});
