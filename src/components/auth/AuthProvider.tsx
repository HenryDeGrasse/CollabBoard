import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
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
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setDisplayName(firebaseUser.displayName || "Anonymous");
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
    const result = await signInWithPopup(auth, provider);
    const name = result.user.displayName || "Google User";
    await set(ref(db, `users/${result.user.uid}`), {
      displayName: name,
      email: result.user.email,
      photoURL: result.user.photoURL,
      authMethod: "google",
    });
    setDisplayName(name);
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
