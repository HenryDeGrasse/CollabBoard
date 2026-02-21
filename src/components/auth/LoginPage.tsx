import { useState } from "react";
import { supabase } from "../../services/supabase";

// ─── Login Page ──────────────────────────────────────────────

export function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signUpName, setSignUpName] = useState("");
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setInfo("");
    if (!email.trim()) { setError("Please enter your email"); return; }
    if (!password) { setError("Please enter your password"); return; }
    if (mode === "signup" && password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error: authErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authErr) setError(authErr.message);
      } else {
        const { data, error: authErr } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: signUpName.trim() || email.trim().split("@")[0] } },
        });
        if (authErr) setError(authErr.message);
        else if (data.user && !data.session) setInfo("Check your email for a confirmation link!");
      }
    } catch { setError("Something went wrong"); }
    finally { setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    setError(""); setInfo(""); setLoading(true);
    try {
      const intendedPath = window.location.pathname;
      if (intendedPath && intendedPath !== "/") {
        localStorage.setItem("collabboard_oauth_return_to", intendedPath);
      }

      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (authError) setError(authError.message);
    } catch { setError("Failed to sign in with Google"); }
    finally { setLoading(false); }
  };

  const handleGuestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = guestName.trim();
    if (!name) { setError("Please enter a display name"); return; }
    setError(""); setInfo(""); setLoading(true);
    try {
      const { error: anonError } = await supabase.auth.signInAnonymously({
        options: { data: { display_name: name } },
      });
      if (!anonError) return;
      const anonCode = (anonError as { code?: string }).code;
      const anonMessage = anonError.message.toLowerCase();
      const isDisabled =
        anonCode === "anonymous_provider_disabled" ||
        anonMessage.includes("anonymous sign-ins are disabled") ||
        anonMessage.includes("anonymous provider disabled");
      if (!isDisabled) { setError(anonError.message); return; }
      const guestId = crypto.randomUUID().slice(0, 12);
      const { error: signUpError } = await supabase.auth.signUp({
        email: `guest-${guestId}@collabboard-app.com`,
        password: crypto.randomUUID(),
        options: { data: { display_name: name } },
      });
      if (signUpError) setError(signUpError.message);
    } catch { setError("Failed to sign in"); }
    finally { setLoading(false); }
  };

  return (
    <>
      <style>{`
        /* ─── Card entrance ─────────────────────────────── */
        .card-enter {
          animation: cardIn 0.4s ease-out both;
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        @media (prefers-reduced-motion: reduce) {
          .card-enter {
            animation: none !important;
            opacity: 1 !important;
          }
        }
      `}</style>

      <div className="min-h-screen bg-newsprint-bg newsprint-texture flex items-center justify-center p-6 relative">
        <div className="card-enter relative z-10 bg-newsprint-bg border-4 border-newsprint-fg sharp-corners shadow-[12px_12px_0px_0px_#111111] w-full max-w-[440px]">
          
          {/* Header */}
          <div className="px-10 pt-12 pb-6 border-b-4 border-newsprint-fg text-center">
            <h1 className="text-4xl sm:text-5xl font-black font-serif text-newsprint-fg uppercase tracking-tighter leading-none mb-2">
              The Collab<br />Board
            </h1>
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-600 font-bold">
              Vol. 1 — Collaboration Edition
            </p>
          </div>

          <div className="flex w-full">
            {/* Left Col: Features */}
            <div className="w-12 border-r-2 border-newsprint-fg hidden sm:flex flex-col items-center py-6 gap-6 justify-center bg-neutral-100">
              <span className="text-[10px] font-mono font-bold uppercase rotate-180" style={{ writingMode: "vertical-rl" }}>Real-time</span>
              <div className="w-2 h-2 bg-newsprint-fg sharp-corners" />
              <span className="text-[10px] font-mono font-bold uppercase rotate-180" style={{ writingMode: "vertical-rl" }}>Infinite</span>
            </div>

            {/* Right Col: Forms */}
            <div className="flex-1">
              <form onSubmit={handleEmailAuth} className="p-8 space-y-4">
                {mode === "signup" && (
                  <input
                    type="text"
                    value={signUpName}
                    onChange={(e) => setSignUpName(e.target.value)}
                    placeholder="DISPLAY NAME"
                    className="w-full px-4 py-3 border-b-2 border-newsprint-fg bg-transparent text-sm font-mono text-newsprint-fg focus-visible:bg-neutral-100 focus-visible:outline-none transition-colors placeholder:text-neutral-500 sharp-corners"
                    disabled={loading}
                    maxLength={30}
                  />
                )}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="EMAIL ADDRESS"
                  className="w-full px-4 py-3 border-b-2 border-newsprint-fg bg-transparent text-sm font-mono text-newsprint-fg focus-visible:bg-neutral-100 focus-visible:outline-none transition-colors placeholder:text-neutral-500 sharp-corners"
                  disabled={loading}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="PASSWORD"
                  className="w-full px-4 py-3 border-b-2 border-newsprint-fg bg-transparent text-sm font-mono text-newsprint-fg focus-visible:bg-neutral-100 focus-visible:outline-none transition-colors placeholder:text-neutral-500 sharp-corners"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 mt-2 bg-newsprint-fg text-newsprint-bg border border-transparent hover:bg-white hover:text-newsprint-fg hover:border-newsprint-fg sharp-corners text-sm font-mono font-bold uppercase tracking-widest transition-colors duration-200 disabled:opacity-50"
                >
                  {loading ? "PROCESSING..." : mode === "signin" ? "SUBSCRIBE" : "SUBSCRIBE"}
                </button>
                <div className="text-center pt-2">
                  <button 
                    type="button"
                    onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setInfo(""); }}
                    className="text-[10px] font-mono font-bold uppercase tracking-widest text-newsprint-fg hover:bg-newsprint-fg hover:text-newsprint-bg transition-colors px-2 py-1 sharp-corners border border-transparent hover:border-newsprint-fg"
                  >
                    {mode === "signin" ? "OR START A NEW SUBSCRIPTION" : "ALREADY SUBSCRIBED? SIGN IN"}
                  </button>
                </div>
              </form>

              <div className="border-t-2 border-b-2 border-newsprint-fg flex">
                <div className="p-4 flex-1 border-r-2 border-newsprint-fg flex items-center justify-center">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500">Or continue with</span>
                </div>
                <button
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="flex-[2] py-4 flex items-center justify-center gap-3 bg-neutral-100 hover:bg-neutral-200 transition-colors disabled:opacity-50 sharp-corners text-xs font-mono font-bold uppercase tracking-widest text-newsprint-fg"
                >
                  <svg className="w-4 h-4 grayscale" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Google
                </button>
              </div>

              <form onSubmit={handleGuestLogin} className="p-8 bg-newsprint-bg">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-500 shrink-0">Guest Pass</span>
                    <div className="h-0.5 bg-newsprint-fg flex-1" />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="GUEST ALIAS"
                      className="flex-1 px-4 py-3 border-b-2 border-newsprint-fg bg-transparent text-sm font-mono text-newsprint-fg focus-visible:bg-neutral-100 focus-visible:outline-none transition-colors placeholder:text-neutral-500 sharp-corners"
                      disabled={loading}
                      maxLength={30}
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-3 border-2 border-newsprint-fg text-newsprint-fg bg-transparent hover:bg-newsprint-fg hover:text-newsprint-bg sharp-corners text-xs font-mono font-bold uppercase tracking-widest transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {loading ? "..." : "ENTER"}
                    </button>
                  </div>
                </div>
              </form>

            </div>
          </div>

          {/* Error / Info Overlays */}
          {error && (
            <div className="absolute -bottom-16 left-0 right-0 z-20 bg-newsprint-accent text-white font-mono font-bold uppercase tracking-widest text-[10px] p-4 sharp-corners border-2 border-newsprint-fg shadow-[4px_4px_0px_0px_#111111]">
              ERROR: {error}
            </div>
          )}
          {info && (
            <div className="absolute -bottom-16 left-0 right-0 z-20 bg-white text-newsprint-fg font-mono font-bold uppercase tracking-widest text-[10px] p-4 sharp-corners border-2 border-newsprint-fg shadow-[4px_4px_0px_0px_#111111]">
              UPDATE: {info}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
