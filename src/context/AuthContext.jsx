// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // ------------------------------------------------------------------
  // Cargar sesión inicial y escuchar cambios
  // ------------------------------------------------------------------
  useEffect(() => {
    const init = async () => {
      console.log("[Auth] initSession: obteniendo sesión actual...");

      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error("[Auth] getSession error:", error);
      }

      console.log("[Auth] Sesión inicial:", data?.session || null);
      setUser(data?.session?.user ?? null);
      setLoading(false);
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[Auth] onAuthStateChange:", event, session);
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // ------------------------------------------------------------------
  // Helpers de autenticación
  // ------------------------------------------------------------------

  const signUpWithEmail = async (email, password) => {
    console.log("[Auth] signUpWithEmail:", email);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      console.error("[Auth] signUpWithEmail error:", error);
      throw error;
    }

    return data;
  };

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

  const signInWithGoogle = async () => {
    console.log("[Auth] signInWithGoogle");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin, // vuelve a tu app
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
  };

  // Puedes ajustar esta lógica como quieras
  const isAdmin = !!user && user.email === "admin@isabelaos.com";

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin,
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return ctx;
}


