import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Test fixture constants
const TEST_INVITE_TOKEN = "test-token-123";
const TEST_ACCESS_TOKEN = "test-access-token";

const mockUseAuth = vi.fn();
vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockAcceptInviteToken = vi.fn();
vi.mock("../../services/board", () => ({
  acceptInviteToken: (...args: any[]) => mockAcceptInviteToken(...args),
}));

import { InviteAcceptPage } from "../../pages/InviteAcceptPage";

const defaultProps = {
  token: TEST_INVITE_TOKEN,
  onNavigateToBoard: vi.fn(),
  onNavigateHome: vi.fn(),
};

describe("InviteAcceptPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user
    mockUseAuth.mockReturnValue({
      user: { id: "user-1" },
      session: { access_token: TEST_ACCESS_TOKEN },
      loading: false,
    });

    // Default: valid invite
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: true, boardTitle: "My Board" }),
      })
    );
  });

  it("shows loading spinner while fetching invite", () => {
    // Make fetch hang
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<InviteAcceptPage {...defaultProps} />);
    expect(screen.getByText("Loading invite…")).toBeTruthy();
  });

  it('shows "Sign In to Continue" when user is not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null, session: null, loading: false });

    render(<InviteAcceptPage {...defaultProps} />);
    expect(screen.getByText("Sign In to Continue")).toBeTruthy();
  });

  it("saves return URL to localStorage when not authenticated", () => {
    mockUseAuth.mockReturnValue({ user: null, session: null, loading: false });
    const spy = vi.spyOn(Storage.prototype, "setItem");

    render(<InviteAcceptPage {...defaultProps} />);
    expect(spy).toHaveBeenCalledWith("collabboard_oauth_return_to", window.location.pathname);

    spy.mockRestore();
  });

  it("shows board title and accept button when invite is valid", async () => {
    render(<InviteAcceptPage {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/My Board/)).toBeTruthy();
      expect(screen.getByText("Accept & Join Board")).toBeTruthy();
    });
  });

  it("shows error message when invite is expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ valid: false, reason: "expired" }),
      })
    );

    render(<InviteAcceptPage {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("This invite link has expired.")).toBeTruthy();
    });
  });

  it("shows error message when invite is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ valid: false, reason: "not_found" }),
      })
    );

    render(<InviteAcceptPage {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("This invite link is invalid or has been revoked.")).toBeTruthy();
    });
  });

  it("calls onNavigateToBoard after successful accept", async () => {
    const onNavigateToBoard = vi.fn();
    mockAcceptInviteToken.mockResolvedValue({ boardId: "board-abc", alreadyMember: false });

    render(<InviteAcceptPage {...defaultProps} onNavigateToBoard={onNavigateToBoard} />);

    await waitFor(() => expect(screen.getByText("Accept & Join Board")).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByText("Accept & Join Board"));

    await waitFor(() => {
      expect(mockAcceptInviteToken).toHaveBeenCalledWith("test-token-123", "test-access-token");
      expect(onNavigateToBoard).toHaveBeenCalledWith("board-abc");
    });
  });

  it("shows already member message", async () => {
    mockAcceptInviteToken.mockResolvedValue({ boardId: "board-abc", alreadyMember: true });

    render(<InviteAcceptPage {...defaultProps} />);

    await waitFor(() => expect(screen.getByText("Accept & Join Board")).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByText("Accept & Join Board"));

    await waitFor(() => {
      expect(screen.getByText("You're already a member!")).toBeTruthy();
    });
  });

  it("Cancel button calls onNavigateHome", async () => {
    const onNavigateHome = vi.fn();
    render(<InviteAcceptPage {...defaultProps} onNavigateHome={onNavigateHome} />);

    await waitFor(() => expect(screen.getByText("Cancel")).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByText("Cancel"));

    expect(onNavigateHome).toHaveBeenCalled();
  });
});
