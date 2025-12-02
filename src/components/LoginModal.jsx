// src/components/LoginModal.jsx
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

function LoginModal({ isOpen, onClose }) {
  const {
    registerWithEmail,
    loginWithEmail,
    loginWithGoogle
  } = useAuth();

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
        await registerWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }

      // Si todo sale bien, cerramos el modal
      onClose();
    } catch (err) {
      console.error('Error en handleSubmit:', err);
      setErrorMsg(err?.message || 'Ocurrió un error al procesar tu solicitud.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErrorMsg('');
    setLoading(true);

    try {
      await loginWithGoogle();
      // Supabase redirige automáticamente
    } catch (err) {
      console.error('Error en login con Google:', err);
      setErrorMsg(err?.message || 'Error al iniciar sesión con Google');
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
          {mode === 'register' ? 'Crea tu cuenta' : 'Inicia sesión'}
        </h2>
        <p>
          Usa tu correo o entra con Google para usar isabelaOs Studio.
        </p>

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
            <p style={{ color: 'red', marginTop: '8px' }}>
              {errorMsg}
            </p>
          )}

          <button type="submit" disabled={loading} className="primary-btn">
            {loading
              ? 'Procesando...'
              : mode === 'register'
              ? 'Registrarme'
              : 'Iniciar sesión'}
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
