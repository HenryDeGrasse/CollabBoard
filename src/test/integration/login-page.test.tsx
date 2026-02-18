import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "../../components/auth/LoginPage";

// Mock supabase
const mockSignInAnonymously = vi.fn().mockResolvedValue({ error: null });
const mockSignUp = vi.fn().mockResolvedValue({ error: null });
const mockSignInWithOAuth = vi.fn().mockResolvedValue({ error: null });
const mockSignInWithPassword = vi.fn().mockResolvedValue({ error: null });

vi.mock("../../services/supabase", () => ({
  supabase: {
    auth: {
      signInAnonymously: (...args: any[]) => mockSignInAnonymously(...args),
      signUp: (...args: any[]) => mockSignUp(...args),
      signInWithOAuth: (...args: any[]) => mockSignInWithOAuth(...args),
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
    },
  },
}));

describe("LoginPage integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInAnonymously.mockResolvedValue({ error: null });
    mockSignUp.mockResolvedValue({ error: null });
    mockSignInWithPassword.mockResolvedValue({ error: null });
  });

  // ── Guest login ──

  it("shows validation error when guest login name is empty", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /join as guest/i }));
    expect(screen.getByText(/please enter a display name/i)).toBeInTheDocument();
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("tries signInAnonymously first with display name", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your name/i), "TestUser");
    await user.click(screen.getByRole("button", { name: /join as guest/i }));

    expect(mockSignInAnonymously).toHaveBeenCalledWith({
      options: { data: { display_name: "TestUser" } },
    });
  });

  it("falls back to signUp only when anonymous sign-in is disabled", async () => {
    mockSignInAnonymously.mockResolvedValue({
      error: { message: "Anonymous sign-ins are disabled", code: "anonymous_provider_disabled" },
    });

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/enter your name/i), "TestUser");
    await user.click(screen.getByRole("button", { name: /join as guest/i }));

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
    await user.click(screen.getByRole("button", { name: /join as guest/i }));

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
    await user.click(screen.getByRole("button", { name: /join as guest/i }));

    await waitFor(() => {
      expect(screen.getByText(/signup disabled/i)).toBeInTheDocument();
    });
  });

  // ── Google OAuth ──

  it("signs in with Google", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      provider: "google",
    }));
  });

  // ── Enter key on guest input ──

  it("supports Enter key for guest login", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const input = screen.getByPlaceholderText(/enter your name/i);
    await user.type(input, "TestUser{enter}");

    expect(mockSignInAnonymously).toHaveBeenCalledWith({
      options: { data: { display_name: "TestUser" } },
    });
  });

  // ── Email/password auth ──

  it("signs in with email and password", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText(/email address/i), "test@example.com");
    await user.type(screen.getByPlaceholderText(/^password$/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "secret123",
    });
  });

  it("shows email validation error", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(screen.getByText(/please enter your email/i)).toBeInTheDocument();
  });

  it("toggles between sign in and sign up", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    // Start in sign-in mode
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();

    // Switch to sign-up — click the "Sign up" link (not the Google button)
    const signUpLink = screen.getByRole("button", { name: /^sign up$/i });
    await user.click(signUpLink);
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/display name/i)).toBeInTheDocument();

    // Switch back — click the "Sign in" link
    const signInLink = screen.getByRole("button", { name: /^sign in$/i });
    await user.click(signInLink);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });
});
