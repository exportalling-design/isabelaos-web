// src/components/VideoFromPromptPanel.jsx
// ------------------------------------------------------------
// VideoFromPromptPanel
// - Genera un video SOLO desde texto (T2V)
// - Costo: 10 jades
// - Cobra jades ANTES de mandar el job (para no tener doble cobro)
// - Poll simple para actualizar estado y mostrar el video
// ------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { COSTS } from "../lib/pricing";

// ❗️NO export default: App.jsx debe tener solo 1 default (App)
export function VideoFromPromptPanel({ userStatus, spendJades }) {
  const { user } = useAuth();

  // ---------------------------
  // UI state
  // ---------------------------
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("IDLE"); // IDLE | STARTING | IN_PROGRESS | DONE | ERROR
  const [statusText, setStatusText] = useState("");
  const [jobId, setJobId] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState("");

  // Costo desde tu pricing central (con fallback)
  const COST_T2V = COSTS?.T2V ?? 10;

  // Validación de jades
  const currentJades = userStatus?.jades ?? 0;
  const hasEnough = currentJades >= COST_T2V;

  // Para evitar doble click / doble request
  const lockRef = useRef(false);

  // ---------------------------
  // Helpers
  // ---------------------------
  const setErrorState = (msg) => {
    setStatus("ERROR");
    setStatusText("Error.");
    setError(msg || "Ocurrió un error.");
  };

  // ---------------------------
  // Generar video (COBRA + crea job)
  // ---------------------------
  async function generate() {
    if (lockRef.current) return;
    lockRef.current = true;

    try {
      setError("");
      setVideoUrl(null);

      if (!user) {
        setErrorState("Debes iniciar sesión para generar video.");
        return;
      }
      if (!prompt.trim()) {
        setErrorState("Escribe un prompt.");
        return;
      }
      if (!hasEnough) {
        setErrorState(`Necesitas ${COST_T2V} jades para Video desde Prompt.`);
        return;
      }

      setStatus("STARTING");
      setStatusText("Cobrando jades y enviando job...");

      // ✅ Cobro (FRONTEND): esto debe ser async y por eso generate() es async
      if (typeof spendJades === "function") {
        await spendJades({ amount: COST_T2V, reason: "t2v" });
      }

      // ✅ Crear job en backend
      const r = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "t2v",
          prompt: prompt.trim(),
          // ✅ muy importante si tu backend también cobra:
          // ya lo cobramos en frontend, así el backend NO debe cobrar otra vez
          already_billed: true,
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok || !j?.job_id) {
        throw new Error(j?.error || "No se pudo crear el job de video.");
      }

      setJobId(j.job_id);
      setStatus("IN_PROGRESS");
      setStatusText(`Generando... Job: ${j.job_id}`);
    } catch (e) {
      setErrorState(e?.message || String(e));
    } finally {
      lockRef.current = false;
    }
  }

  // ---------------------------
  // Poll manual (y auto-poll opcional)
  // ---------------------------
  async function poll() {
    try {
      if (!jobId) return;

      setStatusText("Consultando estado...");

      const r = await fetch(`/api/video-status?job_id=${encodeURIComponent(jobId)}`);
      const j = await r.json().catch(() => null);

      if (!r.ok || !j) throw new Error(j?.error || "Error consultando status.");

      const st = j.status || "IN_PROGRESS";

      if (st === "DONE" || st === "COMPLETED" || st === "SUCCESS") {
        if (j.video_url) {
          setVideoUrl(j.video_url);
          setStatus("DONE");
          setStatusText("Video listo.");
        } else {
          throw new Error("El job terminó pero no devolvió video_url.");
        }
        return;
      }

      if (st === "ERROR" || st === "FAILED") {
        throw new Error(j.error || "El job falló.");
      }

      setStatus("IN_PROGRESS");
      setStatusText(`Estado: ${st}`);
    } catch (e) {
      setErrorState(e?.message || String(e));
    }
  }

  // ✅ Auto-poll cada 5s mientras está en progreso
  useEffect(() => {
    if (!jobId) return;
    if (status !== "IN_PROGRESS") return;

    const t = setInterval(() => {
      poll().catch(() => {});
    }, 5000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status]);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Panel izquierdo */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <h2 className="text-lg font-semibold text-white">Video desde Prompt</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Describe el video y el sistema generará un clip. Costo: <span className="text-white font-semibold">{COST_T2V}</span>{" "}
          jades.
        </p>

        {/* Barra de estado */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Estado: {statusText || "Listo."}</span>
            <span className="text-[11px] text-neutral-400">
              Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span>
            </span>
          </div>
          {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}
        </div>

        {/* Prompt */}
        <div className="mt-4">
          <label className="text-xs text-neutral-300">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe el video..."
            className="mt-2 h-28 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-cyan-400"
          />
        </div>

        {/* Botones */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={!user || !hasEnough || status === "STARTING" || status === "IN_PROGRESS"}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {status === "STARTING" || status === "IN_PROGRESS"
              ? "Generando..."
              : !hasEnough
              ? "Sin jades"
              : "Generar Video"}
          </button>

          <button
            type="button"
            onClick={poll}
            disabled={!jobId || status === "STARTING"}
            className="w-full rounded-2xl border border-white/20 bg-white/5 py-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"
          >
            Actualizar estado
          </button>
        </div>

        {error && <p className="mt-3 text-xs text-red-400 whitespace-pre-line">{error}</p>}
      </div>

      {/* Panel derecho - Resultado */}
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Resultado</h2>

        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
          {videoUrl ? (
            <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
          ) : (
            <p>Aquí verás el video cuando termine.</p>
          )}
        </div>
      </div>
    </div>
  );
}
