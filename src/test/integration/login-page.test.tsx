import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "../../components/auth/LoginPage";

// Mock supabase
const mockSignInAnonymously = vi.fn().mockResolvedValue({ error: null });
const mockSignUp = vi.fn().mockResolvedValue({ error: null });
const mockSignInWithOAuth = vi.fn().mockResolvedValue({ error: null });

vi.mock("../../services/supabase", () => ({
  supabase: {
    auth: {
      signInAnonymously: (...args: any[]) => mockSignInAnonymously(...args),
      signUp: (...args: any[]) => mockSignUp(...args),
      signInWithOAuth: (...args: any[]) => mockSignInWithOAuth(...args),
    },
  },
}));

describe("LoginPage integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInAnonymously.mockResolvedValue({ error: null });
    mockSignUp.mockResolvedValue({ error: null });
  });

  it("shows validation error when guest login name is empty", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /join/i }));
    expect(screen.getByText(/please enter a display name/i)).toBeInTheDocument();
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("tries signInAnonymously first with display name", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your name/i), "TestUser");
    await user.click(screen.getByRole("button", { name: /join/i }));

    expect(mockSignInAnonymously).toHaveBeenCalledWith({
      options: { data: { display_name: "TestUser" } },
    });
  });

  it("falls back to signUp only when anonymous sign-in is disabled", async () => {
    // Simulate anonymous_provider_disabled error
    mockSignInAnonymously.mockResolvedValue({
      error: { message: "Anonymous sign-ins are disabled", code: "anonymous_provider_disabled" },
    });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your name/i), "TestUser");
    await user.click(screen.getByRole("button", { name: /join/i }));

    // Should fall back to signUp with generated email
    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith(
        expect.objectContaining({
          email: expect.stringContaining("@collabboard-app.com"),
          password: expect.any(String),
          options: expect.objectContaining({
            data: { display_name: "TestUser" },
          }),
        })
      );
    });
  });

  it("does not fallback to signUp for non-disabled anonymous errors", async () => {
    mockSignInAnonymously.mockResolvedValue({
      error: { message: "too many requests", code: "over_request_rate_limit" },
    });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your name/i), "TestUser");
    await user.click(screen.getByRole("button", { name: /join/i }));

    await waitFor(() => {
      expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
    });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("shows error when both anonymous and fallback sign-up fail", async () => {
    mockSignInAnonymously.mockResolvedValue({
      error: { message: "Anonymous sign-ins are disabled" },
    });
    mockSignUp.mockResolvedValue({
      error: { message: "Signup disabled" },
    });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your name/i), "TestUser");
    await user.click(screen.getByRole("button", { name: /join/i }));

    await waitFor(() => {
      expect(screen.getByText(/signup disabled/i)).toBeInTheDocument();
    });
  });

  it("signs in with Google", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      provider: "google",
    }));
  });

  it("supports Enter key for guest login", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const input = screen.getByPlaceholderText(/enter your name/i);
    await user.type(input, "TestUser{enter}");

    expect(mockSignInAnonymously).toHaveBeenCalledWith({
      options: { data: { display_name: "TestUser" } },
    });
  });
});
