import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfilePage from "./ProfilePage";
const session = vi.hoisted(() => ({
  account: {
    display_name: "Student",
    email: "student@example.com",
    bio: "",
    study_goal: "",
    avatar: "initials",
    color: "purple",
    id: "account",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  accountError: "",
  user: null,
  demo: { email: "student@example.com" },
  saveAccount: vi.fn(),
  logout: vi.fn(),
  refreshAccount: vi.fn(),
}));
vi.mock("../../Session", () => ({
  useSession: () => session,
  avatarSymbols: { book: "📚", plant: "🌱" },
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it("saves customized details without allowing email changes", async () => {
  const user = userEvent.setup();
  render(<ProfilePage />);
  await user.clear(screen.getByLabelText("Display name"));
  await user.type(screen.getByLabelText("Display name"), "Alex");
  await user.click(screen.getByRole("button", { name: "plant avatar" }));
  await user.click(screen.getByRole("button", { name: "green color" }));
  await user.type(screen.getByLabelText("Study goal"), "Learn Python");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(session.saveAccount).toHaveBeenCalledWith({
      display_name: "Alex",
      bio: "",
      study_goal: "Learn Python",
      avatar: "plant",
      color: "green",
    }),
  );
  expect(await screen.findByText("Profile saved. Looking good!")).toBeTruthy();
});
it("keeps edits when saving fails and exposes logout", async () => {
  session.saveAccount.mockRejectedValueOnce(new Error("Connection lost"));
  const user = userEvent.setup();
  render(<ProfilePage />);
  await user.type(screen.getByLabelText("Study goal"), "Keep learning");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Connection lost",
  );
  expect((screen.getByLabelText("Study goal") as HTMLInputElement).value).toBe(
    "Keep learning",
  );
  await user.click(screen.getByRole("button", { name: "Log out" }));
  expect(session.logout).toHaveBeenCalledOnce();
});
