import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "../../pages/HomePage";

const mockSignOut = vi.fn();

vi.mock("uuid", () => ({
  v4: () => "12345678-1234-5678-1234-567812345678",
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { uid: "user-1" },
    displayName: "Test User",
    signOut: mockSignOut,
  }),
}));

vi.mock("../../services/board", () => ({
  getUserBoardIds: vi.fn().mockResolvedValue([]),
  getBoardsMetadata: vi.fn().mockResolvedValue({}),
  createBoard: vi.fn().mockResolvedValue(undefined),
  addBoardToUser: vi.fn().mockResolvedValue(undefined),
  softDeleteBoard: vi.fn().mockResolvedValue(undefined),
}));

describe("HomePage integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a board via modal with title", async () => {
    const user = userEvent.setup();
    const onNavigateToBoard = vi.fn();
    render(<HomePage onNavigateToBoard={onNavigateToBoard} />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    // Click "New Board" button
    await user.click(screen.getByRole("button", { name: /new board/i }));

    // Modal opens — type a title
    const titleInput = screen.getByPlaceholderText(/board title/i);
    await user.type(titleInput, "My Board");

    // Click Create
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onNavigateToBoard).toHaveBeenCalledWith("12345678");
  });

  it("joins an existing board from input", async () => {
    const user = userEvent.setup();
    const onNavigateToBoard = vi.fn();
    render(<HomePage onNavigateToBoard={onNavigateToBoard} />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText(/board id/i), "board-abc");
    await user.click(screen.getByRole("button", { name: /^join$/i }));

    expect(onNavigateToBoard).toHaveBeenCalledWith("board-abc");
  });

  it("does not join for empty board ID", async () => {
    const user = userEvent.setup();
    const onNavigateToBoard = vi.fn();
    render(<HomePage onNavigateToBoard={onNavigateToBoard} />);

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

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

  it("shows empty state when no boards exist", async () => {
    render(<HomePage onNavigateToBoard={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/no boards yet/i)).toBeInTheDocument();
    });
  });
});
