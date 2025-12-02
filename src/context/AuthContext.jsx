// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// 👉 Cambia esto por tu correo real de admin
const ADMIN_EMAIL = 'stallingtechnologic@gmail.com';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);     // usuario actual
  const [loading, setLoading] = useState(true); // mientras carga la sesión

  useEffect(() => {
    // 1) Revisar si ya hay sesión al recargar la página
    const getSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Error al obtener sesión:', error);
      }
      setUser(data?.session?.user ?? null);
      setLoading(false);
    };

    getSession();

    // 2) Escuchar cambios de sesión (login, logout, etc.)
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  // ---------- FUNCIONES DE AUTH -----------

  // Registro con correo/contraseña
  const registerWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });

    if (error) {
      console.error('Error en signUp:', error);
      throw error;
    }

    // Si SMTP está desactivado, normalmente ya queda logueado
    setUser(data.user);
    return data.user;
  };

  // Login con correo/contraseña
  const loginWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('Error en signInWithPassword:', error);
      throw error;
    }

    setUser(data.user);
    return data.user;
  };

  // Login con Google
  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google'
    });

    if (error) {
      console.error('Error en login con Google:', error);
      throw error;
    }

    // Supabase redirige automáticamente, el useEffect actualizará user
  };

  // Logout
  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error en logout:', error);
      throw error;
    }
    setUser(null);
  };

  const isAdmin = !!user && user.email === ADMIN_EMAIL;

  const value = {
    user,
    loading,
    isAdmin,
    registerWithEmail,
    loginWithEmail,
    loginWithGoogle,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

