import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AuthPage, Landing, ActionPage } from "./PublicPages";
import Root from "./Root";
import { safeNext } from "./paths";
vi.mock("./auth", () => ({ firebaseAuth: null }));
function page(element: React.ReactNode, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
}
describe("public site and authentication", () => {
  it("switches themes and restores the saved choice on another public page", async () => {
    localStorage.setItem("cdmento-public-theme", "light");
    const user = userEvent.setup();
    const view = page(<Root />);
    await user.click(
      screen.getByRole("button", { name: "Switch to dark mode" }),
    );
    expect(document.documentElement.dataset.publicTheme).toBe("dark");
    expect(localStorage.getItem("cdmento-public-theme")).toBe("dark");
    view.unmount();
    page(<Root />, "/get-app");
    expect(
      screen.getByRole("button", { name: "Switch to light mode" }),
    ).toBeTruthy();
    expect(document.documentElement.dataset.publicTheme).toBe("dark");
    await user.click(
      screen.getByRole("button", { name: "Switch to light mode" }),
    );
    expect(document.documentElement.dataset.publicTheme).toBe("light");
    expect(localStorage.getItem("cdmento-public-theme")).toBe("light");
  });
  it("keeps return destinations inside known workspace routes", () => {
    expect(safeNext("/notes?subject=biology")).toBe("/notes?subject=biology");
    for (const value of [
      "https://example.com",
      "//example.com",
      "/login",
      "/notes/../../login",
      null,
    ])
      expect(safeNext(value)).toBe("/workspace");
  });
  it("redirects a signed-out workspace visit to login", async () => {
    page(<Root />, "/notes");
    expect(
      await screen.findByRole("heading", { name: /Welcome back/ }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Create an account" })
        .getAttribute("href"),
    ).toContain("next=%2Fnotes");
  });
  it("describes available AI tools without claiming they are coming soon", () => {
    page(<Landing />);
    expect(
      screen.getByText(/AI-assisted reviewers, flashcards, quizzes, mind maps/),
    ).toBeTruthy();
    expect(
      screen.queryByText(/AI-assisted study tools are coming soon/),
    ).toBeNull();
  });
  it("lets visitors study programming cards and complete a scored quiz", async () => {
    const user = userEvent.setup();
    page(<Landing />);
    expect(screen.getByText("Card 1 of 5")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Reveal flashcard answer" }),
    );
    expect(
      screen.getByRole("button", { name: "Show flashcard question" })
        .textContent,
    ).toContain("let score = 10;");
    await user.click(screen.getByRole("button", { name: "Next flashcard" }));
    expect(screen.getByText("Card 2 of 5")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reveal flashcard answer" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Quick quiz" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Next question",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: /B: const score/ }));
    expect(screen.getByText(/Not quite/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /A: let score/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("tab", { name: "Flashcards" }));
    expect(screen.getByText("Card 2 of 5")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Quick quiz" }));
    await user.click(screen.getByRole("button", { name: "Next question" }));
    for (const answer of ['B: "Hello"', "B: 5", "B: 3 times", "C: 8"]) {
      await user.click(screen.getByRole("button", { name: answer }));
      await user.click(
        screen.getByRole("button", {
          name: answer === "C: 8" ? "See my score" : "Next question",
        }),
      );
    }
    expect(screen.getByText("You scored 4 out of 5!")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Try the quiz again" }),
    );
    expect(screen.getByText("Question 1 of 5")).toBeTruthy();
    expect(screen.getByText("0 correct so far")).toBeTruthy();
  });
  it("validates signup passwords before making an account request", async () => {
    const user = userEvent.setup();
    page(<AuthPage mode="signup" />, "/signup");
    await user.type(screen.getByLabelText("Your name"), "Test Learner");
    await user.type(
      screen.getByLabelText("Email address"),
      "learner@example.com",
    );
    await user.type(
      screen.getByLabelText("Password", { exact: true }),
      "short",
    );
    await user.type(
      screen.getByLabelText("Confirm password", { exact: true }),
      "different",
    );
    await user.click(screen.getByRole("button", { name: "Create my account" }));
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(screen.getByText("Your passwords don’t match.")).toBeTruthy();
  });
  it("supports showing the password and honestly reports unconfigured sign-in", async () => {
    const user = userEvent.setup();
    page(<AuthPage mode="login" />, "/login");
    await user.type(
      screen.getByLabelText("Email address"),
      "learner@example.com",
    );
    const password = screen.getByLabelText("Password", { exact: true });
    await user.type(password, "example-only");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.getAttribute("type")).toBe("text");
    await user.click(
      screen.getByRole("button", { name: "Let’s get learning" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Account services are not connected",
    );
  });
  it("does not claim a password reset was sent without account services", async () => {
    const user = userEvent.setup();
    page(<AuthPage mode="reset" />, "/forgot-password");
    await user.type(
      screen.getByLabelText("Email address"),
      "learner@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "not connected",
    );
    expect(
      screen.queryByRole("heading", { name: "Check your inbox." }),
    ).toBeNull();
  });
  it("rejects email-action URLs without a valid action and code", () => {
    page(<ActionPage />, "/auth/action?mode=unknown");
    expect(
      screen.getByRole("heading", { name: "This link isn’t valid." }),
    ).toBeTruthy();
  });
  it("opens Get the app as a separate public page from mobile navigation", async () => {
    page(<Root />);
    expect(screen.queryByText("Coming soon")).toBeNull();
    const menu = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(menu);
    expect(
      screen
        .getByRole("button", { name: "Close navigation" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    const appLink = screen.getByRole("link", { name: "Get the app" });
    expect(appLink.getAttribute("href")).toBe("/get-app");
    fireEvent.click(appLink);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /Your study buddy/,
      }),
    ).toBeTruthy();
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: /App Store|Google Play/ }),
    ).toBeNull();
  });
});
