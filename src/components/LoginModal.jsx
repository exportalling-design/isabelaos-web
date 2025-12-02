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
        console.log('[LoginModal] signUp con', email);
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
        console.log('[LoginModal] signInWithPassword con', email);
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

      // Supabase ya tiene sesión; AuthContext la detecta con onAuthStateChange
      onClose();
    } catch (err) {
      console.error('[LoginModal] EXCEPCIÓN en handleSubmit:', err);
      let msg = err?.message || 'Ocurrió un error al procesar tu solicitud.';

      // Si viene el mensaje raro minificado:
      if (msg === 'i is not a function' || msg === 'a is not a function') {
        msg =
          'Error interno de autenticación. Intenta recargar la página o vuelve a intentarlo en unos minutos.';
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
      console.log('[LoginModal] Login con Google');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      });

      if (error) {
        console.error('[LoginModal] Error signInWithOAuth:', error);
        throw error;
      }

      console.log('[LoginModal] signInWithOAuth redirigiendo...', data);
      // Supabase redirige, y al volver onAuthStateChange actualiza el user.
    } catch (err) {
      console.error('[LoginModal] EXCEPCIÓN en handleGoogle:', err);
      let msg = err?.message || 'Error al iniciar sesión con Google.';
      if (msg === 'i is not a function' || msg === 'a is not a function') {
        msg = 'Error interno de autenticación con Google.';
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

        <h2>{mode === 'register' ? 'Crea tu cuenta' : 'Inicia sesión'}</h2>
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
              ? 'Registrarme'
              : 'Entrar'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="secondary-btn"
        >
          Continuar con Google
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
