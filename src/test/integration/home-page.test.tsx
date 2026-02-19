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
    session: { access_token: "token-123" },
  }),
}));

// Mock board service
const mockGetUserBoards   = vi.fn().mockResolvedValue([]);
const mockCreateBoard     = vi.fn().mockResolvedValue("new-board-id");
// joinBoard now returns a JoinResult, not void
const mockJoinBoard       = vi.fn().mockResolvedValue({ status: "joined" });
const mockSoftDeleteBoard = vi.fn().mockResolvedValue(undefined);
const mockRemoveBoardMember = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/board", () => ({
  getUserBoards:      (...args: any[]) => mockGetUserBoards(...args),
  createBoard:        (...args: any[]) => mockCreateBoard(...args),
  joinBoard:          (...args: any[]) => mockJoinBoard(...args),
  softDeleteBoard:    (...args: any[]) => mockSoftDeleteBoard(...args),
  removeBoardMember:  (...args: any[]) => mockRemoveBoardMember(...args),
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

    // createBoard now receives visibility as 3rd arg (default "public")
    expect(mockCreateBoard).toHaveBeenCalledWith("My Board", "user-123", "public");
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

  it("shows 'board not found' toast when joinBoard returns not_found", async () => {
    mockJoinBoard.mockResolvedValueOnce({ status: "not_found" });
    const user = userEvent.setup();
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await waitFor(() => {
      expect(screen.getByText(/no boards yet/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/board id/i);
    await user.type(input, "bad-id");
    await user.click(screen.getByRole("button", { name: /^join$/i }));

    await waitFor(() => {
      expect(screen.getByText(/board not found — double-check the id/i)).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates to private board screen when joinBoard returns private", async () => {
    mockJoinBoard.mockResolvedValueOnce({ status: "private" });
    const user = userEvent.setup();
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await waitFor(() => {
      expect(screen.getByText(/no boards yet/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/board id/i);
    await user.type(input, "priv-board-id");
    await user.click(screen.getByRole("button", { name: /^join$/i }));

    expect(mockNavigate).toHaveBeenCalledWith("priv-board-id");
  });

  it("lets a user leave a shared board from dashboard", async () => {
    mockGetUserBoards.mockResolvedValueOnce([
      {
        id: "shared-1",
        title: "Shared Board",
        ownerId: "owner-999",
        visibility: "public",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
      },
    ]);

    const user = userEvent.setup();
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await waitFor(() => {
      expect(screen.getByText(/shared with me/i)).toBeInTheDocument();
      expect(screen.getByText("Shared Board")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/board actions shared board/i));
    await user.click(screen.getByLabelText(/leave board shared board/i));
    await user.click(screen.getByRole("button", { name: /^leave$/i }));

    await waitFor(() => {
      expect(mockRemoveBoardMember).toHaveBeenCalledWith("shared-1", "user-123", "token-123");
    });

    expect(screen.queryByText("Shared Board")).not.toBeInTheDocument();
  });

  it("calls signOut when clicking sign out", async () => {
    const user = userEvent.setup();
    render(<HomePage onNavigateToBoard={mockNavigate} />);

    await user.click(screen.getByText(/sign out/i));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
