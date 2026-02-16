import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  updateProfile,
  type User,
} from "firebase/auth";
import { ref, set } from "firebase/database";
import { auth, db } from "../../services/firebase";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  displayName: string;
  signInAsGuest: (name: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    // Finalize redirect sign-in if present (no-op otherwise)
    getRedirectResult(auth).catch(() => {
      // Ignore here; UI handles auth state separately
    });

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        const name = firebaseUser.displayName || "Anonymous";
        setDisplayName(name);

        // Keep user profile mirrored in RTDB
        await set(ref(db, `users/${firebaseUser.uid}`), {
          displayName: name,
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL,
          authMethod: firebaseUser.isAnonymous ? "anonymous" : "google",
        });
      }

      setLoading(false);
    });

    return unsub;
  }, []);

  const signInAsGuest = async (name: string) => {
    const result = await signInAnonymously(auth);
    await updateProfile(result.user, { displayName: name });
    await set(ref(db, `users/${result.user.uid}`), {
      displayName: name,
      email: null,
      photoURL: null,
      authMethod: "anonymous",
    });
    setDisplayName(name);
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithRedirect(auth, provider);
  };

  const handleSignOut = async () => {
    await auth.signOut();
    setUser(null);
    setDisplayName("");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        displayName,
        signInAsGuest,
        signInWithGoogle,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
