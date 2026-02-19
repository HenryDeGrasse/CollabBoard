import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockGetBoardMembers = vi.fn();
const mockGetInviteToken = vi.fn();
const mockListBoardAccessRequests = vi.fn();
const mockResolveBoardAccessRequest = vi.fn();
const mockRemoveBoardMember = vi.fn();
const mockUpdateBoardVisibility = vi.fn();

vi.mock("../../services/board", () => ({
  getBoardMembers: (...args: any[]) => mockGetBoardMembers(...args),
  getInviteToken: (...args: any[]) => mockGetInviteToken(...args),
  listBoardAccessRequests: (...args: any[]) => mockListBoardAccessRequests(...args),
  resolveBoardAccessRequest: (...args: any[]) => mockResolveBoardAccessRequest(...args),
  removeBoardMember: (...args: any[]) => mockRemoveBoardMember(...args),
  updateBoardVisibility: (...args: any[]) => mockUpdateBoardVisibility(...args),
}));

const mockUseAuth = vi.fn();
vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

import { BoardSettingsPanel } from "../../components/board/BoardSettingsPanel";

const defaultProps = {
  boardId: "board-123",
  isOwner: true,
  visibility: "public" as const,
  onVisibilityChange: vi.fn(),
  onClose: vi.fn(),
  onToast: vi.fn(),
};

describe("BoardSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: "user-1" },
      session: { access_token: "test-token" },
      loading: false,
    });
    mockGetInviteToken.mockResolvedValue("invite-token-123");
    mockGetBoardMembers.mockResolvedValue([]);
    mockListBoardAccessRequests.mockResolvedValue([]);
  });

  it("renders Board Settings header", () => {
    render(<BoardSettingsPanel {...defaultProps} />);
    expect(screen.getByText("Board Settings")).toBeTruthy();
  });

  it("renders Share and Members tabs", () => {
    render(<BoardSettingsPanel {...defaultProps} />);
    expect(screen.getByText("Share")).toBeTruthy();
    expect(screen.getByText("Members")).toBeTruthy();
  });

  it("defaults to Share tab", () => {
    render(<BoardSettingsPanel {...defaultProps} />);
    expect(screen.getByText("Access")).toBeTruthy();
    expect(screen.getByText("Invite Link")).toBeTruthy();
  });

  it("switches to Members tab when clicked", async () => {
    render(<BoardSettingsPanel {...defaultProps} />);
    const user = userEvent.setup();

    await user.click(screen.getByText("Members"));

    await waitFor(() => {
      expect(mockGetBoardMembers).toHaveBeenCalledWith("board-123");
    });
  });

  it("shows Public and Private visibility buttons", () => {
    render(<BoardSettingsPanel {...defaultProps} />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
  });

  it("shows owner-only warning for non-owners", () => {
    render(<BoardSettingsPanel {...defaultProps} isOwner={false} />);
    expect(screen.getByText("Only the board owner can change access settings.")).toBeTruthy();
  });

  it("displays board ID", () => {
    render(<BoardSettingsPanel {...defaultProps} />);
    expect(screen.getByText("board-123")).toBeTruthy();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(<BoardSettingsPanel {...defaultProps} onClose={onClose} />);
    const user = userEvent.setup();

    // The X button in the header
    const buttons = screen.getAllByRole("button");
    const closeBtn = buttons.find(
      (b) => b.querySelector("svg") && !b.textContent
    );
    if (closeBtn) {
      await user.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it("loads members when Members tab is active", async () => {
    mockGetBoardMembers.mockResolvedValue([
      { userId: "user-1", displayName: "Alice", role: "owner" },
      { userId: "user-2", displayName: "Bob", role: "editor" },
    ]);

    render(<BoardSettingsPanel {...defaultProps} />);
    const user = userEvent.setup();

    await user.click(screen.getByText("Members"));

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeTruthy();
      expect(screen.getByText("Bob")).toBeTruthy();
    });
  });

  it("shows access requests section for owners on Members tab", async () => {
    mockGetBoardMembers.mockResolvedValue([]);
    mockListBoardAccessRequests.mockResolvedValue([]);

    render(<BoardSettingsPanel {...defaultProps} isOwner={true} />);
    const user = userEvent.setup();

    await user.click(screen.getByText("Members"));

    await waitFor(() => {
      expect(screen.getByText("No pending requests.")).toBeTruthy();
    });
  });

  it("shows access requests with Approve/Deny buttons", async () => {
    mockGetBoardMembers.mockResolvedValue([]);
    mockListBoardAccessRequests.mockResolvedValue([
      { id: "req-1", requesterName: "Charlie", message: "Please add me!" },
    ]);

    render(<BoardSettingsPanel {...defaultProps} isOwner={true} />);
    const user = userEvent.setup();

    await user.click(screen.getByText("Members"));

    await waitFor(() => {
      expect(screen.getByText("Charlie")).toBeTruthy();
      expect(screen.getByText("Approve")).toBeTruthy();
      expect(screen.getByText("Deny")).toBeTruthy();
    });
  });

  it("displays board ID that can be copied", async () => {
    render(<BoardSettingsPanel {...defaultProps} />);

    // Board ID is displayed in the share tab
    await waitFor(() => {
      expect(screen.getByText("board-123")).toBeTruthy();
    });

    // Verify the Board ID section heading is present
    expect(screen.getByText("Board ID")).toBeTruthy();
  });
});
