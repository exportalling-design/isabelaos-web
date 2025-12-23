import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// -----------------------------------------------------
// Contexto
// -----------------------------------------------------
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null); // ✅ NUEVO
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------
  // Cargar sesión inicial y escuchar cambios
  // ---------------------------------------------------
  useEffect(() => {
    console.log("[Auth] initSession: obteniendo sesión actual...");

    const loadSession = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error("[Auth] getSession error:", error);
      }

      const currentSession = data?.session ?? null;
      const currentUser = currentSession?.user ?? null;

      console.log("[Auth] Sesión inicial:", currentUser);

      setSession(currentSession); // ✅
      setUser(currentUser);
      setLoading(false);
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log(
        "[Auth] onAuthStateChange:",
        event,
        session?.user ?? null
      );

      setSession(session ?? null); // ✅
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // ---------------------------------------------------
  // Métodos de autenticación
  // ---------------------------------------------------
  const signInWithEmail = async (email, password) => {
    console.log("[Auth] signInWithEmail:", email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("[Auth] signInWithEmail error:", error);
      throw error;
    }

    return data;
  };

  const signUpWithEmail = async (email, password) => {
    console.log("[Auth] signUpWithEmail:", email);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/`
            : undefined,
      },
    });

    if (error) {
      console.error("[Auth] signUpWithEmail error:", error);
      throw error;
    }

    return data;
  };

  const signInWithGoogle = async () => {
    console.log("[Auth] signInWithGoogle");

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/`
            : undefined,
      },
    });

    if (error) {
      console.error("[Auth] signInWithGoogle error:", error);
      throw error;
    }

    return data;
  };

  const signOut = async () => {
    console.log("[Auth] signOut");

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("[Auth] signOut error:", error);
      throw error;
    }

    setSession(null); // ✅ limpieza explícita
    setUser(null);
  };

  // ---------------------------------------------------
  // Context value
  // ---------------------------------------------------
  const value = {
    user,
    session, // ✅ CLAVE PARA fetchWithAuth
    loading,
    isAdmin: !!user && user.email === "admin@isabelaos.com",
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {/* Evita parpadeos mientras se hidrata la sesión */}
      {!loading && children}
    </AuthContext.Provider>
  );
}

// -----------------------------------------------------
// Hook
// -----------------------------------------------------
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider />");
  }
  return ctx;
}