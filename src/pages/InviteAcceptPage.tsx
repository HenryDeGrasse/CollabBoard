import { useState, useEffect } from "react";
import { useAuth } from "../components/auth/AuthProvider";
import { acceptInviteToken } from "../services/board";

interface InviteAcceptPageProps {
  token: string;
  onNavigateToBoard: (boardId: string) => void;
  onNavigateHome: () => void;
}

type State =
  | { phase: "loading" }
  | { phase: "ready"; boardTitle: string }
  | { phase: "accepting" }
  | { phase: "error"; message: string }
  | { phase: "already_member"; boardId: string };

export function InviteAcceptPage({ token, onNavigateToBoard, onNavigateHome }: InviteAcceptPageProps) {
  const { user, loading: authLoading, session } = useAuth();
  const [state, setState] = useState<State>({ phase: "loading" });

  // Preview the invite via the public API endpoint — no auth required
  useEffect(() => {
    async function resolve() {
      try {
        const res = await fetch(`/api/invites?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!res.ok || !data.valid) {
          const msg =
            data.reason === "expired"
              ? "This invite link has expired."
              : "This invite link is invalid or has been revoked.";
          setState({ phase: "error", message: msg });
          return;
        }

        setState({ phase: "ready", boardTitle: data.boardTitle });
      } catch {
        setState({ phase: "error", message: "Could not load invite. Please check your connection." });
      }
    }

    resolve();
  }, [token]);

  async function handleAccept() {
    if (!session) return;
    setState({ phase: "accepting" });

    try {
      const result = await acceptInviteToken(token, session.access_token);

      if (result.alreadyMember) {
        setState({ phase: "already_member", boardId: result.boardId });
        setTimeout(() => onNavigateToBoard(result.boardId), 1500);
      } else {
        onNavigateToBoard(result.boardId);
      }
    } catch (err: any) {
      setState({ phase: "error", message: err.message ?? "Something went wrong." });
    }
  }

  // ── Not logged in ──
  if (!authLoading && !user) {
    // Save the invite URL so after login we redirect back
    localStorage.setItem("collabboard_oauth_return_to", window.location.pathname);

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">You've been invited!</h1>
          <p className="text-gray-500 text-sm mb-6">Sign in to accept this board invitation.</p>
          <button
            onClick={onNavigateHome}
            className="w-full py-3 rounded-xl text-white font-medium transition shadow-md"
            style={{ backgroundColor: "#0F2044" }}
          >
            Sign In to Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
        {state.phase === "loading" && (
          <>
            <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 text-sm">Loading invite…</p>
          </>
        )}

        {state.phase === "ready" && (
          <>
            <div className="text-4xl mb-4">📋</div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">You've been invited!</h1>
            <p className="text-gray-500 text-sm mb-6">
              Join the board <span className="font-semibold text-gray-700">"{state.boardTitle}"</span> as an editor.
            </p>
            <button
              onClick={handleAccept}
              className="w-full py-3 rounded-xl text-white font-medium transition shadow-md hover:opacity-90 mb-3"
              style={{ backgroundColor: "#0F2044" }}
            >
              Accept & Join Board
            </button>
            <button
              onClick={onNavigateHome}
              className="w-full py-2.5 rounded-xl text-sm text-gray-500 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </>
        )}

        {state.phase === "accepting" && (
          <>
            <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 text-sm">Joining board…</p>
          </>
        )}

        {state.phase === "already_member" && (
          <>
            <div className="text-4xl mb-4">✅</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">You're already a member!</h1>
            <p className="text-gray-500 text-sm">Redirecting to the board…</p>
          </>
        )}

        {state.phase === "error" && (
          <>
            <div className="text-4xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Invite unavailable</h1>
            <p className="text-gray-500 text-sm mb-6">{state.message}</p>
            <button
              onClick={onNavigateHome}
              className="w-full py-3 rounded-xl text-white font-medium transition shadow-md"
              style={{ backgroundColor: "#0F2044" }}
            >
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
