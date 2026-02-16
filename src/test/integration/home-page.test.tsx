import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "../../pages/HomePage";

const mockSignOut = vi.fn();

vi.mock("uuid", () => ({
  v4: () => "12345678-1234-5678-1234-567812345678",
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    displayName: "Test User",
    signOut: mockSignOut,
  }),
}));

describe("HomePage integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a board with an 8-char id slice", async () => {
    const user = userEvent.setup();
    const onNavigateToBoard = vi.fn();
    render(<HomePage onNavigateToBoard={onNavigateToBoard} />);

    await user.click(screen.getByRole("button", { name: /create new board/i }));

    expect(onNavigateToBoard).toHaveBeenCalledWith("12345678");
  });

  it("joins an existing board from input", async () => {
    const user = userEvent.setup();
    const onNavigateToBoard = vi.fn();
    render(<HomePage onNavigateToBoard={onNavigateToBoard} />);

    await user.type(screen.getByPlaceholderText(/enter board id/i), "board-abc");
    await user.click(screen.getByRole("button", { name: /^join$/i }));

    expect(onNavigateToBoard).toHaveBeenCalledWith("board-abc");
  });

  it("does not join for empty board ID", async () => {
    const user = userEvent.setup();
    const onNavigateToBoard = vi.fn();
    render(<HomePage onNavigateToBoard={onNavigateToBoard} />);

    const joinButton = screen.getByRole("button", { name: /^join$/i });
    expect(joinButton).toBeDisabled();

    await user.click(joinButton);
    expect(onNavigateToBoard).not.toHaveBeenCalled();
  });

  it("calls signOut when clicking sign out", async () => {
    const user = userEvent.setup();
    const onNavigateToBoard = vi.fn();
    render(<HomePage onNavigateToBoard={onNavigateToBoard} />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
