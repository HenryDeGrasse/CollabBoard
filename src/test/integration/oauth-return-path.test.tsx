import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useAuth } from "../../components/auth/AuthProvider";
import App from "../../App";

// Stub auth
vi.mock("../../components/auth/AuthProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/auth/AuthProvider")>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

// Stub board page and home page so we don't need Konva/Supabase
vi.mock("../../pages/BoardPage", () => ({
  BoardPage: ({ boardId }: { boardId: string }) => (
    <div data-testid="board-page">board:{boardId}</div>
  ),
}));

vi.mock("../../pages/HomePage", () => ({
  HomePage: () => <div data-testid="home-page">home</div>,
}));

const mockUseAuth = vi.mocked(useAuth);

describe("OAuth return-path restoration (App.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset URL to "/"
    window.history.pushState(null, "", "/");
  });

  it("redirects to saved board path after Google OAuth login", async () => {
    localStorage.setItem("collabboard_oauth_return_to", "/board/shared-board-123");

    mockUseAuth.mockReturnValue({
      user: { id: "user-1" } as any,
      session: {} as any,
      displayName: "Test User",
      loading: false,
      signOut: vi.fn(),
    });

    render(<App />);

    // Should navigate to the saved board, not the home page
    await waitFor(() => {
      expect(screen.getByTestId("board-page")).toBeInTheDocument();
      expect(screen.getByText("board:shared-board-123")).toBeInTheDocument();
    });

    // localStorage entry must be cleared after use
    expect(localStorage.getItem("collabboard_oauth_return_to")).toBeNull();
  });

  it("stays on home page when no return path is saved", async () => {
    // No entry in localStorage
    mockUseAuth.mockReturnValue({
      user: { id: "user-1" } as any,
      session: {} as any,
      displayName: "Test User",
      loading: false,
      signOut: vi.fn(),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });
  });

  it("ignores malformed return paths", async () => {
    // Not a board path
    localStorage.setItem("collabboard_oauth_return_to", "/settings/danger");

    mockUseAuth.mockReturnValue({
      user: { id: "user-1" } as any,
      session: {} as any,
      displayName: "Test User",
      loading: false,
      signOut: vi.fn(),
    });

    render(<App />);

    // Should stay on home (bad path pattern doesn't match /board/<id>)
    await waitFor(() => {
      expect(screen.getByTestId("home-page")).toBeInTheDocument();
    });

    expect(localStorage.getItem("collabboard_oauth_return_to")).toBeNull();
  });

  it("shows login page when user is null", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      displayName: "",
      loading: false,
      signOut: vi.fn(),
    });

    render(<App />);
    // LoginPage renders the guest name input
    expect(screen.getByPlaceholderText(/guest alias/i)).toBeInTheDocument();
  });
});
