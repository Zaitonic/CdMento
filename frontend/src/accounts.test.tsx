import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthPage } from "./PublicPages";
const mocks = vi.hoisted(() => ({
  persistence: vi.fn(),
  signin: vi.fn(),
  signup: vi.fn(),
  profile: vi.fn(),
  verify: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("./auth", () => ({ firebaseAuth: { currentUser: null } }));
vi.mock("./api", () => ({
  api: vi.fn().mockResolvedValue({ auth_mode: "firebase" }),
}));
vi.mock("./Session", () => ({
  useSession: () => ({
    user: null,
    loading: false,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("firebase/auth", () => ({
  browserLocalPersistence: "local",
  browserSessionPersistence: "session",
  setPersistence: mocks.persistence,
  signInWithEmailAndPassword: mocks.signin,
  createUserWithEmailAndPassword: mocks.signup,
  updateProfile: mocks.profile,
  sendEmailVerification: mocks.verify,
  sendPasswordResetEmail: mocks.reset,
  applyActionCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
  verifyPasswordResetCode: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.signin.mockResolvedValue({ user: { emailVerified: true } });
  mocks.signup.mockResolvedValue({ user: { uid: "new-user" } });
});
function page(mode: "login" | "signup" | "reset") {
  render(
    <MemoryRouter initialEntries={["/entry?next=%2Fnotes"]}>
      <Routes>
        <Route path="/entry" element={<AuthPage mode={mode} />} />
        <Route path="/notes" element={<p>Your notes workspace</p>} />
        <Route path="/verify-email" element={<p>Verify your account</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
async function credentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Email address"),
    "learner@example.com",
  );
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "example-only",
  );
}
describe("configured account flows", () => {
  it("honors session-only persistence and returns to the requested workspace", async () => {
    const user = userEvent.setup();
    page("login");
    await credentials(user);
    await user.click(
      screen.getByRole("checkbox", { name: "Keep me signed in" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Let’s get learning" }),
    );
    expect(await screen.findByText("Your notes workspace")).toBeTruthy();
    expect(mocks.persistence).toHaveBeenCalledWith(
      expect.anything(),
      "session",
    );
    expect(mocks.signin).toHaveBeenCalledWith(
      expect.anything(),
      "learner@example.com",
      "example-only",
    );
  });
  it("routes an unverified account to email verification", async () => {
    mocks.signin.mockResolvedValue({ user: { emailVerified: false } });
    const user = userEvent.setup();
    page("login");
    await credentials(user);
    await user.click(
      screen.getByRole("button", { name: "Let’s get learning" }),
    );
    expect(await screen.findByText("Verify your account")).toBeTruthy();
  });
  it("creates the account, updates the name, and requests verification", async () => {
    const user = userEvent.setup();
    page("signup");
    await user.type(screen.getByLabelText("Your name"), "Curious Learner");
    await credentials(user);
    await user.type(
      screen.getByLabelText("Confirm password", { exact: true }),
      "example-only",
    );
    await user.click(screen.getByRole("button", { name: "Create my account" }));
    expect(await screen.findByText("Verify your account")).toBeTruthy();
    expect(mocks.profile).toHaveBeenCalledWith(
      { uid: "new-user" },
      { displayName: "Curious Learner" },
    );
    expect(mocks.verify).toHaveBeenCalledOnce();
  });
  it("gives a neutral confirmation after a successful reset request", async () => {
    const user = userEvent.setup();
    page("reset");
    await user.type(
      screen.getByLabelText("Email address"),
      "learner@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(
      await screen.findByRole("heading", { name: "Check your inbox." }),
    ).toBeTruthy();
    expect(screen.getByText(/If an account exists/)).toBeTruthy();
    expect(mocks.reset).toHaveBeenCalledOnce();
  });
  it("does not reveal whether a password-reset email is registered", async () => {
    mocks.reset.mockRejectedValueOnce({ code: "auth/user-not-found" });
    const user = userEvent.setup();
    page("reset");
    await user.type(
      screen.getByLabelText("Email address"),
      "unknown@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(
      await screen.findByRole("heading", { name: "Check your inbox." }),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
