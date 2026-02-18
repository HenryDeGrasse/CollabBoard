import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePage } from "../../pages/HomePage";

// Mock auth context
const mockSignOut = vi.fn();
vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-123" },
    displayName: "TestUser",
    signOut: mockSignOut,
    loading: false,
    session: {},
  }),
}));

// Mock board service
const mockGetUserBoards = vi.fn().mockResolvedValue([]);
const mockCreateBoard = vi.fn().mockResolvedValue("new-board-id");
const mockJoinBoard = vi.fn().mockResolvedValue(undefined);
const mockSoftDeleteBoard = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/board", () => ({
  getUserBoards: (...args: any[]) => mockGetUserBoards(...args),
  createBoard: (...args: any[]) => mockCreateBoard(...args),
  joinBoard: (...args: any[]) => mockJoinBoard(...args),
  softDeleteBoard: (...args: any[]) => mockSoftDeleteBoard(...args),
}));

describe("HomePage integration", () => {
  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no boards exist", async () => {
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await waitFor(() => {
      expect(screen.getByText(/no boards yet/i)).toBeInTheDocument();
    });
  });

  it("creates a board via modal with title", async () => {
    const user = userEvent.setup();
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await waitFor(() => {
      expect(screen.getByText(/no boards yet/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /new board/i }));
    const titleInput = screen.getByPlaceholderText(/board title/i);
    await user.type(titleInput, "My Board");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(mockCreateBoard).toHaveBeenCalledWith("My Board", "user-123");
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("new-board-id");
    });
  });

  it("does not join for empty board ID", async () => {
    const user = userEvent.setup();
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await waitFor(() => {
      expect(screen.getByText(/no boards yet/i)).toBeInTheDocument();
    });

    const joinBtn = screen.getByRole("button", { name: /^join$/i });
    expect(joinBtn).toBeDisabled();
  });

  it("joins an existing board from input", async () => {
    const user = userEvent.setup();
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await waitFor(() => {
      expect(screen.getByText(/no boards yet/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/board id/i);
    await user.type(input, "abc-123");
    await user.click(screen.getByRole("button", { name: /^join$/i }));

    expect(mockJoinBoard).toHaveBeenCalledWith("abc-123", "user-123");
  });

  it("calls signOut when clicking sign out", async () => {
    const user = userEvent.setup();
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await user.click(screen.getByText(/sign out/i));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
