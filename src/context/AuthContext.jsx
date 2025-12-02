// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// -----------------------------------------------------
// Contexto
// -----------------------------------------------------
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Cargar sesión inicial y suscribirnos a cambios
  useEffect(() => {
    console.log("[Auth] initSession: obteniendo sesión actual...");

    const loadSession = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error("[Auth] getSession error:", error);
      }

      const currentUser = data?.session?.user ?? null;
      console.log("[Auth] Sesión inicial:", currentUser);
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
        // Adonde vuelve Supabase después de confirmar correo (si lo tienes activo)
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

    // IMPORTANTE: esta llamada normalmente redirige a Google,
    // por eso no hacemos nada más aquí.
    return data;
  };

  const signOut = async () => {
    console.log("[Auth] signOut");
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("[Auth] signOut error:", error);
      throw error;
    }
  };

  const value = {
    user,
    loading,
    // Ajusta este correo al admin real si quieres
    isAdmin: !!user && user.email === "admin@isabelaos.com",
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {/* Mientras loading es true, evitamos parpadeos raros */}
      {!loading && children}
    </AuthContext.Provider>
  );
}

// Hook para usar el contexto
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider />");
  }
  return ctx;
}


