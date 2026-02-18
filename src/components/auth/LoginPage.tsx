import { useState } from "react";
import { supabase } from "../../services/supabase";

// ─── Ghost Cursor ────────────────────────────────────────────

function GhostCursor({
  name,
  color,
  style,
  animClass,
}: {
  name: string;
  color: string;
  style?: React.CSSProperties;
  animClass: string;
}) {
  return (
    <div className={`absolute pointer-events-none select-none ${animClass}`} style={style}>
      <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
        {/* Cursor tip is at (1.5, 1) — top-left of this SVG */}
        <path
          d="M1.5 1L1.5 19L11.5 13L1.5 1Z"
          fill={color}
          fillOpacity="0.9"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div
        className="ml-3 -mt-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold text-white whitespace-nowrap shadow-sm"
        style={{ backgroundColor: color }}
      >
        {name}
      </div>
    </div>
  );
}

// ─── Animated Logo ───────────────────────────────────────────

function AnimatedLogo() {
  return (
    <div className="relative w-16 h-16 mx-auto mb-3">
      {/* Cursor 1 — deep navy */}
      <svg className="absolute logo-c1" width="30" height="36" viewBox="0 0 30 36" fill="none" style={{ top: 2, left: 4 }}>
        <path d="M2 2L2 30L17 22L2 2Z" fill="#0F2044" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      {/* Cursor 2 — mint */}
      <svg className="absolute logo-c2" width="30" height="36" viewBox="0 0 30 36" fill="none" style={{ bottom: 0, right: 2 }}>
        <path d="M2 2L2 30L17 22L2 2Z" fill="#10B981" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <div className="absolute inset-0 logo-glow rounded-2xl" />
    </div>
  );
}

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
        /* ─── Logo ─────────────────────────────────────── */
        .logo-c1 {
          opacity: 0;
          animation: logoIn1 0.6s ease-out forwards,
                     logoOrbit1 7s ease-in-out 0.8s infinite;
        }
        .logo-c2 {
          opacity: 0;
          animation: logoIn2 0.6s ease-out 0.15s forwards,
                     logoOrbit2 7s ease-in-out 0.95s infinite;
        }
        @keyframes logoIn1 {
          from { transform: translateX(-20px) rotate(-20deg); opacity: 0; }
          to   { transform: translate(-4px, -2px) rotate(-8deg); opacity: 1; }
        }
        @keyframes logoIn2 {
          from { transform: translateX(20px) rotate(20deg); opacity: 0; }
          to   { transform: translate(4px, 2px) rotate(8deg); opacity: 1; }
        }
        @keyframes logoOrbit1 {
          0%, 100% { transform: translate(-4px, -2px) rotate(-8deg); }
          50%      { transform: translate(4px,  2px) rotate( 8deg); }
        }
        @keyframes logoOrbit2 {
          0%, 100% { transform: translate(4px,  2px) rotate( 8deg); }
          50%      { transform: translate(-4px, -2px) rotate(-8deg); }
        }
        .logo-glow {
          background: radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%);
          animation: glowPulse 3s ease-in-out infinite;
        }
        @keyframes glowPulse {
          0%, 100% { opacity: 0.4; }
          50%      { opacity: 1;   }
        }

        /* ─── Card entrance ─────────────────────────────── */
        .card-enter {
          animation: cardIn 0.45s ease-out 0.05s both;
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0);    }
        }

        /* ─── Dot grid — navy tinted ────────────────────── */
        .dot-grid {
          background-image: radial-gradient(circle, rgba(15,32,68,0.10) 1.5px, transparent 1.5px);
          background-size: 28px 28px;
        }

        /* ─── Story animation (18s shared loop) ─────────── */
        /*
          Sarah  starts: left 8%,  top 22%
          Note   placed: left 20%, top 32%  (+12vw, +10vh from Sarah)
          Alex   starts: right 10% (≈ left 85%), top 58%
          Alex → note:       translate(-65vw, -26vh)
          Alex → off-screen: translate( 30vw, -26vh)
          Note → off-screen: translate( 95vw,   0  )
        */

        /* Sarah — arrives, "clicks" to place the note, wanders off */
        .ghost-sarah { animation: sarah 18s ease-in-out infinite; }
        @keyframes sarah {
          0%   { transform: translate(0, 0);       opacity: 0;    }
          2%   {                                    opacity: 0.44; }
          14%  { transform: translate(12vw, 10vh); opacity: 0.44; } /* arrives at drop point */
          30%  { transform: translate(12vw, 10vh); opacity: 0.44; } /* holds — note snaps at 17.5% */
          44%  { transform: translate(30vw,  2vh); opacity: 0.44; } /* drifts away */
          64%  { transform: translate( 8vw,-10vh); opacity: 0.44; }
          80%  { transform: translate( 8vw,-10vh); opacity: 0;    } /* fade out */
          82%  { transform: translate(0, 0);       opacity: 0;    } /* invisible reset */
          100% { transform: translate(0, 0);       opacity: 0;    }
        }

        /* Alex — waits, approaches, grabs the note, drags it off screen */
        .ghost-alex { animation: alex 18s ease-in-out infinite; }
        @keyframes alex {
          0%   { transform: translate(0, 0);           opacity: 0;    }
          32%  { transform: translate(0, 0);           opacity: 0;    } /* idle while Sarah works */
          35%  {                                        opacity: 0.38; } /* fades in, starts moving */
          56%  { transform: translate(-65vw, -26vh);   opacity: 0.38; } /* arrives at note */
          63%  { transform: translate(-65vw, -26vh);   opacity: 0.38; } /* "grab" pause */
          78%  { transform: translate( 30vw, -26vh);   opacity: 0.38; } /* off screen with note */
          82%  { transform: translate( 30vw, -26vh);   opacity: 0;    } /* fade out */
          84%  { transform: translate(0, 0);           opacity: 0;    } /* invisible reset */
          100% { transform: translate(0, 0);           opacity: 0;    }
        }

        /* Jordan — independent free wanderer (11s) */
        .ghost-jordan { animation: jordan 11s ease-in-out infinite; }
        @keyframes jordan {
          0%, 100% { transform: translate(  0,    0); }
          30%      { transform: translate(-14vw, -16vh); }
          65%      { transform: translate( 10vw, -10vh); }
        }

        /* ─── Story sticky note ─────────────────────────── */
        /* Positioned at Sarah's cursor tip: left 20%, top 32%  */
        /* transform-origin: top left → grows from cursor tip   */
        .story-note {
          position: absolute;
          left: 20%;
          top: 32%;
          transform-origin: top left;
          pointer-events: none;
          animation: storyNote 18s ease-in-out infinite;
        }
        @keyframes storyNote {
          0%    { opacity: 0; transform: scale(0);    }
          17%   { opacity: 0; transform: scale(0);    } /* Sarah just arrived */

          /* SNAP — fast overshoot, exactly like clicking the sticky tool */
          17.5% { opacity: 1; transform: scale(1.12); }
          19%   { opacity: 1; transform: scale(0.94); }
          20.5% { opacity: 1; transform: scale(1);    } /* settled */

          /* sits while Alex approaches */
          55%   { opacity: 0.85; transform: translate(  0,   0) scale(1); }
          63%   { opacity: 0.85; transform: translate(  0,   0) scale(1); } /* grabbed */

          /* dragged off screen right with Alex */
          78%   { opacity: 0.85; transform: translate(95vw,  0) scale(1); }
          82%   { opacity: 0;    transform: translate(97vw,  0) scale(1); }

          84%   { opacity: 0; transform: scale(0); } /* invisible reset */
          100%  { opacity: 0; transform: scale(0); }
        }

        /* ─── Reduced motion ────────────────────────────── */
        @media (prefers-reduced-motion: reduce) {
          .logo-c1, .logo-c2, .logo-glow, .card-enter,
          .ghost-sarah, .ghost-alex, .ghost-jordan, .story-note {
            animation: none !important;
            opacity: 1 !important;
          }
          .story-note { opacity: 0 !important; }
        }
      `}</style>

      {/* ── Page ──────────────────────────────────────────────── */}
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4 overflow-hidden relative">

        {/* Dot grid — navy tinted */}
        <div className="absolute inset-0 dot-grid" />

        {/* Faint static whiteboard objects — navy + mint tones */}
        <div className="absolute top-[12%] left-[6%]   w-28 h-28 rounded-xl  rotate-3  bg-slate-400/[0.09]   border border-slate-300/20" />
        <div className="absolute top-[55%] right-[8%]  w-24 h-20 rounded-xl -rotate-6  bg-emerald-400/[0.09] border border-emerald-300/20" />
        <div className="absolute bottom-[18%] left-[56%] w-36 h-24 rounded-xl  rotate-1  bg-slate-300/[0.08]   border border-slate-200/20" />
        <div className="absolute top-[28%] right-[28%] w-14 h-14 rounded-full           bg-emerald-300/[0.08]" />
        <div className="absolute top-[8%]  right-[16%] w-20 h-20 rounded-xl -rotate-2  bg-blue-300/[0.07]    border border-blue-200/20" />

        {/* ── Story sticky note — mint colored, grows from Sarah's cursor tip ── */}
        <div className="story-note">
          <div className="w-[72px] h-[72px] bg-emerald-100 rounded-lg shadow-lg rotate-1 flex flex-col p-2 gap-1.5 overflow-hidden">
            <div className="h-1.5 w-full bg-emerald-400/50 rounded-sm shrink-0" />
            <div className="h-1   w-full   bg-emerald-600/20 rounded-sm" />
            <div className="h-1   w-4/5    bg-emerald-600/15 rounded-sm" />
            <div className="h-1   w-full   bg-emerald-600/20 rounded-sm" />
            <div className="h-1   w-2/3    bg-emerald-600/12 rounded-sm" />
          </div>
        </div>

        {/* ── Ghost cursors ──────────────────────────────────── */}
        {/* Sarah = navy (places the note) */}
        <GhostCursor name="Sarah"  color="#0F2044" animClass="ghost-sarah"
          style={{ left: "8%",  top: "22%", opacity: 0.50 }} />
        {/* Alex = mint (drags the note off) */}
        <GhostCursor name="Alex"   color="#10B981" animClass="ghost-alex"
          style={{ right: "10%", top: "58%", opacity: 0.44 }} />
        {/* Jordan = slate (free wanderer) */}
        <GhostCursor name="Jordan" color="#475569" animClass="ghost-jordan"
          style={{ left: "28%", top: "68%", opacity: 0.36 }} />

        {/* ── Login Card ─────────────────────────────────────── */}
        <div className="card-enter relative z-10 bg-white/60 backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-200/60 w-full max-w-[420px]">

          {/* Header */}
          <div className="px-8 pt-8 pb-2 text-center">
            <AnimatedLogo />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0F2044" }}>
              CollabBoard
            </h1>
            <p className="text-sm text-slate-500 mt-1">Think together, in real time</p>
          </div>

          {/* Email / Password */}
          <form onSubmit={handleEmailAuth} className="px-8 pt-5 pb-3 space-y-3">
            {mode === "signup" && (
              <input
                type="text"
                value={signUpName}
                onChange={(e) => setSignUpName(e.target.value)}
                placeholder="Display name"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none bg-white/80 transition"
                disabled={loading}
                maxLength={30}
              />
            )}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none bg-white/80 transition"
              disabled={loading}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none bg-white/80 transition"
              disabled={loading}
            />
            {/* Mint accent button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              style={{ backgroundColor: "#10B981", boxShadow: "0 4px 14px rgba(16,185,129,0.30)" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#059669")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#10B981")}
            >
              {loading ? "..." : mode === "signin" ? "Sign In" : "Create Account"}
            </button>
            <p className="text-center text-xs text-slate-400">
              {mode === "signin" ? (
                <>No account?{" "}
                  <button type="button"
                    onClick={() => { setMode("signup"); setError(""); setInfo(""); }}
                    className="font-medium hover:underline" style={{ color: "#10B981" }}>
                    Sign up
                  </button></>
              ) : (
                <>Already have one?{" "}
                  <button type="button"
                    onClick={() => { setMode("signin"); setError(""); setInfo(""); }}
                    className="font-medium hover:underline" style={{ color: "#10B981" }}>
                    Sign in
                  </button></>
              )}
            </p>
          </form>

          {/* — or continue with — */}
          <div className="px-8 flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">or continue with</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Google */}
          <div className="px-8 pt-3">
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 bg-white/70"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>
          </div>

          {/* — or try it out — */}
          <div className="px-8 pt-3 flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">or try it out</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Guest */}
          <form onSubmit={handleGuestLogin} className="px-8 pt-3 pb-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Enter your name"
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none bg-white/80 transition"
                disabled={loading}
                maxLength={30}
              />
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition disabled:opacity-50 whitespace-nowrap"
              >
                {loading ? "..." : "Join as Guest"}
              </button>
            </div>
          </form>

          {/* Error / Info */}
          {error && (
            <div className="px-8 pt-1 pb-1">
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 text-center">{error}</p>
            </div>
          )}
          {info && (
            <div className="px-8 pt-1 pb-1">
              <p className="text-sm text-emerald-600 bg-emerald-50 rounded-xl px-4 py-2 text-center">{info}</p>
            </div>
          )}

          {/* Feature pills */}
          <div className="px-8 pt-4 pb-6 flex items-center justify-center gap-3 text-[11px] text-slate-400 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Real-time cursors
            </span>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "#0F2044", opacity: 0.6 }} />
              AI templates
            </span>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
              Infinite canvas
            </span>
          </div>
        </div>

        {/* Bottom note */}
        <p className="absolute bottom-4 text-[11px] text-slate-400/60 tracking-wide z-10">
          Free to use · No credit card required
        </p>
      </div>
    </>
  );
}
