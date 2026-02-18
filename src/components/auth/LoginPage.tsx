import { useState } from "react";
import { supabase } from "../../services/supabase";

export function LoginPage() {
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGuestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = guestName.trim();
    if (!name) {
      setError("Please enter a display name");
      return;
    }
    setError("");
    setLoading(true);

    try {
      // Try anonymous sign-in first
      const { error: anonError } = await supabase.auth.signInAnonymously({
        options: {
          data: { display_name: name },
        },
      });

      if (!anonError) return; // Success

      const anonCode = (anonError as { code?: string }).code;
      const anonMessage = anonError.message.toLowerCase();
      const isAnonymousDisabled =
        anonCode === "anonymous_provider_disabled" ||
        anonMessage.includes("anonymous sign-ins are disabled") ||
        anonMessage.includes("anonymous provider disabled");

      if (!isAnonymousDisabled) {
        // For transient/rate-limit errors, surface the original error and do not
        // trigger email-signup fallback (which can hit email rate limits).
        setError(anonError.message);
        return;
      }

      // If anonymous sign-in is disabled, fall back to email signup
      // with a generated guest email/password.
      const guestId = crypto.randomUUID().slice(0, 12);
      const guestEmail = `guest-${guestId}@collabboard-app.com`;
      const guestPassword = crypto.randomUUID();

      const { error: signUpError } = await supabase.auth.signUp({
        email: guestEmail,
        password: guestPassword,
        options: {
          data: { display_name: name },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
      }
    } catch (err) {
      setError("Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (authError) {
        setError(authError.message);
      }
    } catch (err) {
      setError("Failed to sign in with Google");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-4 text-center">
          <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🎨</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">CollabBoard</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time collaborative whiteboard</p>
        </div>

        {/* Guest Login */}
        <form onSubmit={handleGuestLogin} className="px-8 pb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Continue as Guest
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Enter your name"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              disabled={loading}
              maxLength={30}
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {loading ? "..." : "Join"}
            </button>
          </div>
        </form>

        {/* Divider */}
        <div className="px-8 py-2 flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400 uppercase">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Google Login */}
        <div className="px-8 pb-8">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="px-8 pb-4">
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
