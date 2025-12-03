// src/App.jsx
import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext";
import {
  saveGenerationInSupabase,
  loadGenerationsForUser,
} from "./lib/generations";

// ---------------------------------------------------------
// Helper para scroll suave
// ---------------------------------------------------------
function scrollToId(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ---------------------------------------------------------
// Modal de autenticación (correo + password + Google)
// ---------------------------------------------------------
function AuthModal({ open, onClose }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLocalLoading(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
        alert(
          "Cuenta creada. Si Supabase lo requiere, revisa tu correo para confirmar la cuenta."
        );
      }
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLocalLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setLocalLoading(true);
    try {
      await signInWithGoogle();
      // Supabase redirige automáticamente
    } catch (err) {
      setError(err.message || String(err));
      setLocalLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/90 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {mode === "login" ? "Inicia sesión" : "Crea tu cuenta"}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1 text-neutral-400 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-xs text-neutral-400">
          Usa tu correo o entra con Google para usar isabelaOs Studio.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-neutral-300">Correo</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-300">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            type="submit"
            disabled={localLoading}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {localLoading
              ? "Procesando..."
              : mode === "login"
              ? "Entrar"
              : "Registrarme"}
          </button>
        </form>

        <button
          onClick={handleGoogle}
          disabled={localLoading}
          className="mt-3 w-full rounded-2xl border border-white/20 py-2 text-sm text-white hover:bg-white/10 disabled:opacity-60"
        >
          Continuar con Google
        </button>

        <p className="mt-3 text-center text-xs text-neutral-400">
          {mode === "login" ? (
            <>
              ¿No tienes cuenta?{" "}
              <button
                type="button"
                onClick={() => setMode("register")}
                className="text-cyan-300 underline"
              >
                Regístrate aquí
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button
                type="button"
                onClick={() => setMode("login")}
                className="text-cyan-300 underline"
              >
                Inicia sesión
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Panel del creador (RunPod)
// ---------------------------------------------------------
function CreatorPanel() {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState(
    "Cinematic portrait, ultra detailed, soft light, 8k"
  );
  const [negative, setNegative] = useState(
    "blurry, low quality, deformed, watermark, text"
  );
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [steps, setSteps] = useState(22);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [imageB64, setImageB64] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");

  // 🔹 NUEVO: contador diario y límite
  const [dailyCount, setDailyCount] = useState(0);
  const DAILY_LIMIT = 10;

  // 🔹 Cargar historial desde Supabase cuando haya usuario
  useEffect(() => {
    if (!user) {
      setHistory([]);
      setDailyCount(0);
      return;
    }

    (async () => {
      const rows = await loadGenerationsForUser(user.id);

      const mapped = rows.map((row) => {
        let b64 = "";

        // asumimos que guardamos un data URL en image_url
        if (row.image_url && row.image_url.startsWith("data:image")) {
          const parts = row.image_url.split(",");
          b64 = parts[1] || "";
        }

        return {
          id: row.id,
          prompt: "", // no usamos el prompt guardado
          createdAt: row.created_at,
          image_b64: b64,
        };
      });

      setHistory(mapped);

      // 🔹 calcular cuántas imágenes son de HOY
      const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
      const countToday = rows.filter(
        (row) =>
          row.created_at &&
          typeof row.created_at === "string" &&
          row.created_at.startsWith(todayStr)
      ).length;
      setDailyCount(countToday);
    })();
  }, [user]);

  const handleGenerate = async () => {
    setError("");

    // 🔹 Chequeo de límite diario
    if (dailyCount >= DAILY_LIMIT) {
      setStatus("ERROR");
      setStatusText("Límite diario alcanzado.");
      setError(
        `Has llegado al límite de ${DAILY_LIMIT} imágenes por hoy. Vuelve mañana o activa el plan de $5/mes para seguir generando sin límites mientras la beta siga activa.`
      );
      return;
    }

    setImageB64(null);
    setStatus("IN_QUEUE");
    setStatusText("Enviando job a RunPod...");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          negative_prompt: negative,
          width: Number(width),
          height: Number(height),
          steps: Number(steps),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(
          data?.error || "Error en /api/generate, revisa los logs."
        );
      }

      const jobId = data.jobId;
      setStatusText(`Job enviado. ID: ${jobId}. Consultando estado...`);

      let finished = false;
      while (!finished) {
        await new Promise((r) => setTimeout(r, 2000));

        const statusRes = await fetch(`/api/status?id=${jobId}`);
        const statusData = await statusRes.json();

        if (!statusRes.ok || statusData.error) {
          throw new Error(
            statusData.error || "Error al consultar /api/status."
          );
        }

        const st = statusData.status;
        setStatus(st);
        setStatusText(`Estado actual: ${st}...`);

        if (st === "IN_QUEUE" || st === "IN_PROGRESS") continue;

        finished = true;

        if (st === "COMPLETED" && statusData.output?.image_b64) {
          const b64 = statusData.output.image_b64;
          setImageB64(b64);

          const newItem = {
            id: jobId,
            prompt,
            createdAt: new Date().toISOString(),
            image_b64: b64,
          };

          // historial local
          setHistory((prev) => [newItem, ...prev]);
          setStatusText("Render completado.");

          // 🔹 incrementar contador diario
          setDailyCount((prev) => prev + 1);

          // 🔹 Guardar también en Supabase (si hay usuario)
          if (user?.id) {
            const dataUrl = `data:image/png;base64,${b64}`;
            saveGenerationInSupabase({
              userId: user.id,
              imageUrl: dataUrl,
              prompt: "", // no guardamos prompt
              negativePrompt: "",
              width: Number(width),
              height: Number(height),
              steps: Number(steps),
            }).catch((e) => {
              console.error("Error guardando en Supabase:", e);
            });
          }
        } else {
          throw new Error("Job terminado pero sin imagen en la salida.");
        }
      }
    } catch (err) {
      console.error(err);
      setStatus("ERROR");
      setStatusText("Error al generar la imagen.");
      setError(err.message || String(err));
    }
  };

  // 🔹 NUEVO: eliminar imagen del historial local de la sesión
  const handleDeleteFromHistory = (id) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        <p className="font-medium">
          Debes iniciar sesión para usar el generador de imágenes.
        </p>
        <p className="mt-1 text-xs text-yellow-200/80">
          Desde tu cuenta podrás crear imágenes con nuestro motor real conectado
          a RunPod, con 10 imágenes gratis al día. Si quieres ir más allá,
          podrás activar el plan de $5/mes para generar ilimitadas mientras
          dure la beta.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Formulario */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">
          Generador desde prompt
        </h2>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <label className="text-neutral-300">Prompt</label>
            <textarea
              className="mt-1 h-24 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text.white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div>
            <label className="text-neutral-300">Negative prompt</label>
            <textarea
              className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-neutral-300">Steps</label>
              <input
                type="number"
                min={5}
                max={50}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
              />
            </div>
            <div>
              <label className="text-neutral-300">Width</label>
              <input
                type="number"
                min={256}
                max={1024}
                step={64}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
              />
            </div>
            <div>
              <label className="text-neutral-300">Height</label>
              <input
                type="number"
                min={256}
                max={1024}
                step={64}
                className="mt-1 w-full rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-2 rounded-2xl bg-black/50 px-4 py-2 text-xs text-neutral-300">
            Estado actual: {statusText || "Listo para generar."}
            <br />
            <span className="text-[11px] text-neutral-400">
              Uso de hoy: {dailyCount} / {DAILY_LIMIT} imágenes (gratis).
              Después de esas 10, podrás seguir generando ilimitadas con el
              plan de $5/mes mientras la beta siga activa.
            </span>
          </div>

          {error && (
            <p className="text-xs text-red-400 whitespace-pre-line">{error}</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={
              status === "IN_QUEUE" ||
              status === "IN_PROGRESS" ||
              dailyCount >= DAILY_LIMIT
            }
            className="mt-4 w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {dailyCount >= DAILY_LIMIT
              ? "Límite diario alcanzado"
              : status === "IN_QUEUE" || status === "IN_PROGRESS"
              ? "Generando..."
              : "Generar imagen desde prompt"}
          </button>
        </div>

        {/* Biblioteca sesión */}
        <div className="mt-6 border-t border-white/10 pt-4">
          <h3 className="text-sm font-semibold text-white">
            Biblioteca de esta sesión
          </h3>
          {history.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-400">
              Aún no has generado imágenes en esta sesión.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-3">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/50"
                >
                  <button
                    type="button"
                    className="block w-full"
                    onClick={() => setImageB64(item.image_b64)}
                  >
                    <img
                      src={`data:image/png;base64,${item.image_b64}`}
                      alt={item.prompt}
                      className="h-24 w-full object-cover group-hover:opacity-80"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition text-[10px] text-white flex items-end p-2">
                      <span className="line-clamp-2">{item.prompt}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFromHistory(item.id);
                    }}
                    className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-1 text-[10px] text-neutral-200 hover:bg-red-600 hover:text-white"
                    title="Eliminar imagen de esta sesión"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-neutral-500">
            Por ahora las imágenes también se guardan en tu cuenta (Supabase),
            además de esta sesión. Aquí puedes eliminar solo las vistas de esta
            sesión si quieres mantener tu panel más limpio.
          </p>
        </div>
      </div>

      {/* Resultado */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text.white">Resultado</h2>
        <div className="mt-4 flex h-[420px] items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {imageB64 ? (
            <img
              src={`data:image/png;base64,${imageB64}`}
              alt="Imagen generada"
              className="h-full w-full rounded-2xl object-contain"
            />
          ) : (
            <p>Aquí verás el resultado en cuanto se complete el render.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Vista de Dashboard (solo para usuarios logueados)
// ---------------------------------------------------------
function DashboardView() {
  const { user, isAdmin, signOut } = useAuth();

  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.10),transparent_50%),#06070B",
      }}
    >
      {/* Header compacto */}
      <header className="border-b border-white/10 bg-black/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs{" "}
                <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Panel del creador · Beta
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="hidden sm:inline text-neutral-300">
              {user?.email} {isAdmin && "· admin"}
            </span>
            <button
              onClick={signOut}
              className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      {/* Solo el panel */}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-white">
              Panel del creador
            </h1>
            <p className="mt-1 text-xs text-neutral-400">
              Genera imágenes directamente desde tu cuenta conectada al
              pipeline real en RunPod.
            </p>
          </div>

          <CreatorPanel />
        </section>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// Vista Landing (para visitantes sin sesión)
// ---------------------------------------------------------
function LandingView({ onOpenAuth }) {
  return (
    <div
      className="min-h-screen w-full text-white"
      style={{
        background:
          "radial-gradient(1200px_800px_at_110%_-10%,rgba(255,23,229,0.12),transparent_60%),radial-gradient(900px_600px_at_-10%_0%,rgba(0,229,255,0.10),transparent_50%),#06070B",
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-xs font-bold">
              io
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">
                isabelaOs{" "}
                <span className="text-xs text-neutral-400">Studio</span>
              </div>
              <div className="text-[10px] text-neutral-500">
                Generación visual con IA desde Guatemala
              </div>
            </div>
          </div>

          <button
            onClick={onOpenAuth}
            className="rounded-xl border border-white/20 px-4 py-1.5 text-xs text-white hover:bg-white/10"
          >
            Iniciar sesión
          </button>
        </div>
      </header>

      {/* Hero / landing */}
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
        <section className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
              Beta privada · Solo generación de imagen
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
              isabelaOs Studio{" "}
              <span className="block bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                generación de imágenes con IA en la nube
              </span>
            </h1>
            <p className="mt-4 max-w-xl text-sm text-neutral-300">
              Crea imágenes con calidad de estudio con el primer sistema de
              generación visual con IA desarrollado desde{" "}
              <span className="font-semibold text-cyan-300">Guatemala</span>{" "}
              para Latinoamérica. Versión inicial enfocada solo en{" "}
              <span className="font-medium text-cyan-300">
                generación de imagen
              </span>
              , mientras terminamos los módulos de video y nuestro motor propio
              de realismo corporal{" "}
              <span className="font-semibold text-fuchsia-300">
                BodySync v1
              </span>{" "}
              (movimiento y expresión más naturales) ·{" "}
              <span className="text-yellow-300 font-semibold">
                próximamente
              </span>
              .
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={() => scrollToId("panel-creador")}
                className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-2 text-sm font-semibold text.white"
              >
                Probar generador en vivo
              </button>
              <button
                onClick={onOpenAuth}
                className="rounded-2xl border border-white/20 px-5 py-2 text-xs text-white hover:bg-white/10"
              >
                Iniciar sesión / registrarse
              </button>
            </div>

            <p className="mt-4 text-xs text-neutral-400">
              Plan actual:{" "}
              <span className="font-semibold text-white">
                10 imágenes gratis al día
              </span>{" "}
              por usuario. Si quieres seguir generando, podrás activar el plan{" "}
              <span className="font-semibold text-white">$5/mes</span> con
              generación ilimitada de imágenes mientras isabelaOs Studio se
              mantenga en beta.
            </p>
          </div>

          <div className="relative">
            <div className="h-full w-full rounded-3xl border border-white/10 bg-black/50 p-5 text-xs text-neutral-300">
              <h3 className="text-sm font-semibold text-white">
                Vista previa del panel
              </h3>
              <p className="mt-2 text-[11px] text-neutral-400">
                Interfaz simple para escribir un prompt, ajustar resolución y
                ver el resultado generado por el motor conectado a RunPod.
              </p>
              <div className="mt-4 h-52 rounded-2xl bg-gradient-to-br from-cyan-500/10 via-fuchsia-500/10 to-black/80 border border-white/10 flex items-center justify-center text-[11px] text-neutral-300">
                Panel real de isabelaOs Studio funcionando con tu endpoint
                serverless y preparado para integrar BodySync v1 en las próximas
                versiones.
              </div>
              <p className="mt-3 text-[10px] text-neutral-500">
                isabelaOs Studio es el primer sistema de generación visual con
                IA desarrollado desde Guatemala pensando en creadores, estudios
                y agencias de modelos virtuales.
              </p>
            </div>
          </div>
        </section>

        {/* Panel del creador “demo” (mismo panel real) */}
        <section id="panel-creador" className="mt-16 space-y-6">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Panel del creador
              </h2>
              <p className="mt-1 text-xs text-neutral-400">
                Escribe un prompt y deja que isabelaOs Studio genere una imagen
                usando nuestro pipeline real en RunPod. 10 imágenes diarias
                gratis; después podrás seguir generando con el plan de $5/mes
                ilimitado mientras dure la beta.
              </p>
            </div>
          </div>

          <CreatorPanel />
        </section>

        <footer className="mt-16 border-t border-white/10 pt-6 text-[11px] text-neutral-500">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              © {new Date().getFullYear()} isabelaOs Studio · Desarrollado en
              Guatemala por Stalling Technologic.
            </span>
            <span>
              Versión beta · Módulos futuros: video, BodySync v1, CineCam y más.
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ---------------------------------------------------------
// App principal
// ---------------------------------------------------------
export default function App() {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    document.documentElement.style.background = "#06070B";
  }, []);

  const openAuth = () => setShowAuthModal(true);
  const closeAuth = () => setShowAuthModal(false);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-black text-white">
        <p className="text-sm text-neutral-400">Cargando sesión...</p>
      </div>
    );
  }

  return (
    <>
      {user ? (
        <DashboardView />
      ) : (
        <LandingView onOpenAuth={openAuth} />
      )}
      <AuthModal open={showAuthModal} onClose={closeAuth} />
    </>
  );
}
