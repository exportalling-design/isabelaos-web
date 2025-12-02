// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("[Auth] initSession: obteniendo sesión actual...");

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error("[Auth] getSession error:", error);
        }
        setUser(data?.session?.user ?? null);
        console.log("[Auth] Sesión inicial:", data?.session?.user ?? null);
      } catch (err) {
        console.error("[Auth] EXCEPCIÓN getSession:", err);
      } finally {
        setLoading(false);
      }
    };

    init();

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
      subscription?.unsubscribe?.();
    };
  }, []);

  const isAdmin = !!user?.email && user.email.endsWith("@isabelaos.com");

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
        redirectTo: window.location.origin,
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

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);


