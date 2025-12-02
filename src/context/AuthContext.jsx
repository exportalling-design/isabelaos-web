// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// 👉 Cambia esto por tu correo real de admin
const ADMIN_EMAIL = 'stallingtechnologic@gmail.com';

// El contexto va a manejar toda la sesión
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // ----------------- EFECTO INICIAL -----------------
  useEffect(() => {
    const initSession = async () => {
      console.log('[Auth] initSession: obteniendo sesión actual...');
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error('[Auth] Error al obtener sesión:', error);
      } else {
        console.log('[Auth] Sesión inicial:', data?.session);
      }

      setUser(data?.session?.user ?? null);
      setLoading(false);
    };

    initSession();

    // Escuchar cambios de sesión
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] onAuthStateChange:', event, session);
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // ----------------- FUNCIONES DE AUTH -----------------

  // Registro con correo/contraseña
  const registerWithEmail = async (email, password) => {
    console.log('[Auth] registerWithEmail llamado con:', email);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        console.error('[Auth] Error en signUp:', error);
        throw error;
      }

      console.log('[Auth] signUp ok, data:', data);
      setUser(data.user ?? null);
      return data.user;
    } catch (err) {
      console.error('[Auth] EXCEPCIÓN en registerWithEmail:', err);
      // Enviamos un error "limpio" al componente
      throw new Error(err?.message || 'Error registrando usuario.');
    }
  };

  // Login con correo/contraseña
  const loginWithEmail = async (email, password) => {
    console.log('[Auth] loginWithEmail llamado con:', email);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('[Auth] Error en signInWithPassword:', error);
        throw error;
      }

      console.log('[Auth] signInWithPassword ok, data:', data);
      setUser(data.user ?? null);
      return data.user;
    } catch (err) {
      console.error('[Auth] EXCEPCIÓN en loginWithEmail:', err);
      throw new Error(err?.message || 'Error al iniciar sesión.');
    }
  };

  // Login con Google
  const loginWithGoogle = async () => {
    console.log('[Auth] loginWithGoogle llamado');

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      });

      if (error) {
        console.error('[Auth] Error en signInWithOAuth:', error);
        throw error;
      }

      console.log('[Auth] signInWithOAuth redirigiendo...', data);
      // No seteamos user aquí porque Supabase redirige y luego
      // onAuthStateChange se encarga de actualizar user.
    } catch (err) {
      console.error('[Auth] EXCEPCIÓN en loginWithGoogle:', err);
      throw new Error(err?.message || 'Error al iniciar sesión con Google.');
    }
  };

  // Logout
  const logout = async () => {
    console.log('[Auth] logout llamado');
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('[Auth] Error en logout:', error);
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
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    console.error(
      '[Auth] useAuth llamado fuera de <AuthProvider>. Revisa main.jsx.'
    );
  }
  return ctx;
}

