import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../../services/supabase";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  displayName: string;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  displayName: "",
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadDisplayName(s.user);
      }
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadDisplayName(s.user);
      } else {
        setDisplayName("");
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadDisplayName(u: User) {
    // Try metadata first (set during sign-up)
    const metaName = u.user_metadata?.display_name || u.user_metadata?.full_name;
    if (metaName) {
      setDisplayName(metaName);
      return;
    }

    // Try profiles table
    const { data } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", u.id)
      .single();

    if (data?.display_name) {
      setDisplayName(data.display_name);
    } else {
      setDisplayName("Anonymous");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ user, session, displayName, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
