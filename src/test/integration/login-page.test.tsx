import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "../../components/auth/LoginPage";

const mockSignInAsGuest = vi.fn();
const mockSignInWithGoogle = vi.fn();

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    signInAsGuest: mockSignInAsGuest,
    signInWithGoogle: mockSignInWithGoogle,
  }),
}));

describe("LoginPage integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows validation error when guest login name is empty", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    await user.click(screen.getByRole("button", { name: /continue as guest/i }));

    expect(screen.getByText(/please enter a display name/i)).toBeInTheDocument();
    expect(mockSignInAsGuest).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("signs in as guest and calls onSuccess", async () => {
    const user = userEvent.setup();
    mockSignInAsGuest.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/display name/i), "Henry");
    await user.click(screen.getByRole("button", { name: /continue as guest/i }));

    expect(mockSignInAsGuest).toHaveBeenCalledWith("Henry");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows Google sign-in error message when auth fails", async () => {
    const user = userEvent.setup();
    mockSignInWithGoogle.mockRejectedValueOnce(new Error("Popup blocked"));
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    await user.click(screen.getByRole("button", { name: /sign in with google/i }));

    expect(screen.getByText(/popup blocked/i)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("supports Enter key for guest login", async () => {
    const user = userEvent.setup();
    mockSignInAsGuest.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    render(<LoginPage onSuccess={onSuccess} />);

    const input = screen.getByLabelText(/display name/i);
    await user.type(input, "Ava");
    await user.keyboard("{Enter}");

    expect(mockSignInAsGuest).toHaveBeenCalledWith("Ava");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
