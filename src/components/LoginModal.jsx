// src/components/LoginModal.jsx
import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

function LoginModal({ isOpen, onClose }) {
  const { user } = useAuth() || {};
  const [mode, setMode] = useState('register'); // 'register' | 'login'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      if (mode === 'register') {
        console.log('[LoginModal] REGISTRO con', email);
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) {
          console.error('[LoginModal] Error signUp:', error);
          throw error;
        }

        console.log('[LoginModal] signUp OK:', data);
      } else {
        console.log('[LoginModal] LOGIN con', email);
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          console.error('[LoginModal] Error signInWithPassword:', error);
          throw error;
        }

        console.log('[LoginModal] signIn OK:', data);
      }

      onClose();
    } catch (err) {
      console.error('[LoginModal] EXCEPCIÓN handleSubmit:', err);
      let msg = err?.message || 'Ocurrió un error al procesar tu solicitud.';

      // Forzamos a NO mostrar "i is not a function"
      if (msg === 'i is not a function' || msg === 'a is not a function') {
        msg =
          '⚠️ Error interno de autenticación. Intenta recargar la página y probar de nuevo.';
      }

      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErrorMsg('');
    setLoading(true);

    try {
      console.log('[LoginModal] LOGIN GOOGLE');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      });

      if (error) {
        console.error('[LoginModal] Error signInWithOAuth:', error);
        throw error;
      }

      console.log('[LoginModal] signInWithOAuth OK, redirigiendo...', data);
      // Supabase redirige; al volver, AuthContext actualiza user.
    } catch (err) {
      console.error('[LoginModal] EXCEPCIÓN handleGoogle:', err);
      let msg = err?.message || 'Error al iniciar sesión con Google.';
      if (msg === 'i is not a function' || msg === 'a is not a function') {
        msg = '⚠️ Error interno de autenticación con Google.';
      }
      setErrorMsg(msg);
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setErrorMsg('');
    setMode((prev) => (prev === 'register' ? 'login' : 'register'));
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>

        <h2>
          {mode === 'register'
            ? 'Crea tu cuenta (NUEVO MODAL)'
            : 'Inicia sesión (NUEVO MODAL)'}
        </h2>

        <p>Usa tu correo o entra con Google para usar isabelaOs Studio.</p>

        <form onSubmit={handleSubmit}>
          <label>
            Correo
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>

          {errorMsg && (
            <p style={{ color: 'red', marginTop: '8px' }}>{errorMsg}</p>
          )}

          <button type="submit" disabled={loading} className="primary-btn">
            {loading
              ? 'Procesando...'
              : mode === 'register'
              ? '🚀 Crear cuenta'
              : '✅ Entrar'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="secondary-btn"
        >
          Continuar con Google (NUEVO)
        </button>

        <p style={{ marginTop: '12px' }}>
          {mode === 'register'
            ? '¿Ya tienes cuenta?'
            : '¿No tienes cuenta aún?'}{' '}
          <button
            type="button"
            onClick={toggleMode}
            className="link-btn"
          >
            {mode === 'register'
              ? 'Inicia sesión aquí'
              : 'Regístrate aquí'}
          </button>
        </p>
      </div>
    </div>
  );
}

export default LoginModal;

