// src/components/Img2VideoPanel.jsx
// ─────────────────────────────────────────────────────────────
// Panel Imagen → Video — Kling vía PiAPI
// Modos: Express (Kling 2.1 pro 5s) y Standard (Kling 2.1 std 10s / Kling 3.0 pro 15s)
// Audio:
//   none              → video mudo
//   native            → Kling genera audio solo (+6 jades)
//   elevenlabs_lipsync→ ElevenLabs TTS + Kling lipsync (+8 jades)
// ─────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";

const FORCED_PREFIX =
  "NO subtitles, NO text overlays, NO captions, NO watermarks, NO generated text of any kind. " +
  "Do NOT invent new characters, objects, or backgrounds not present in the source image. " +
  "Keep all original characters, faces, clothing, and environment exactly as they appear in the image. " +
  "Only add natural realistic motion to existing elements. ";

const ACCENTS = [
  { value: "neutro",       label: "🌎 Neutro latino" },
  { value: "guatemalteco", label: "🇬🇹 Guatemalteco" },
  { value: "colombiano",   label: "🇨🇴 Colombiano"   },
  { value: "mexicano",     label: "🇲🇽 Mexicano"     },
  { value: "argentino",    label: "🇦🇷 Argentino"    },
  { value: "español",      label: "🇪🇸 Español"      },
  { value: "ingles",       label: "🇺🇸 English (US)" },
];

async function checkImageSafety(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 50; canvas.height = 50;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 50, 50);
      const data = ctx.getImageData(0, 0, 50, 50).data;
      URL.revokeObjectURL(url);
      let skinPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 95 && g > 40 && b > 20 && r > g && r > b &&
            Math.abs(r - g) > 15 && r - b > 15 && g - b > 0) skinPixels++;
      }
      resolve((skinPixels / (50 * 50)) < 0.60);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(true); };
    img.src = url;
  });
}

export function Img2VideoPanel({ userStatus }) {
  const { user } = useAuth();
  const STORAGE_KEY = user?.id ? `i2v_job_state_${user.id}` : "i2v_job_state_guest";

  const [dataUrl,    setDataUrl]    = useState(null);
  const [pureB64,    setPureB64]    = useState(null);
  const [imageUrl,   setImageUrl]   = useState("");
  const [prompt,     setPrompt]     = useState("");
  const [negative,   setNegative]   = useState("");

  const [generationMode,  setGenerationMode]  = useState("standard");
  const [useNineSixteen,  setUseNineSixteen]  = useState(true);
  const [durationSec,     setDurationSec]     = useState(10);

  // audio_mode: "none" | "native" | "elevenlabs_lipsync"
  const [audioMode,      setAudioMode]      = useState("none");
  const [narrationText,  setNarrationText]  = useState("");
  const [voiceAccent,    setVoiceAccent]    = useState("neutro");
  const [voiceGender,    setVoiceGender]    = useState("mujer");

  const [showPhotoConsent, setShowPhotoConsent] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState(null);
  const [showModuleInfo,   setShowModuleInfo]   = useState(false);

  const [status,             setStatus]             = useState("IDLE");
  const [statusText,         setStatusText]         = useState("");
  const [jobId,              setJobId]              = useState(null);
  const [videoUrl,           setVideoUrl]           = useState(null);
  const [error,              setError]              = useState("");
  const [progress,           setProgress]           = useState(0);
  const [needsManualRefresh, setNeedsManualRefresh] = useState(false);
  const [lastKnownJob,       setLastKnownJob]       = useState(null);

  const currentJades = userStatus?.jades ?? 0;
  const fileInputId  = "img2video-file-input";
  const lockRef      = useRef(false);
  const pollTimerRef = useRef(null);
  const progTimerRef = useRef(null);

  // ── Precios ───────────────────────────────────────────────────
  function getCurrentPrice() {
    let base = generationMode === "express" ? 15
             : durationSec === 15           ? 24
             :                                17;
    if (audioMode === "native")             base += 6;
    if (audioMode === "elevenlabs_lipsync") base += 8;
    return base;
  }

  const COST_I2V  = getCurrentPrice();
  const hasEnough = currentJades >= COST_I2V;

  function getPriceText() {
    const base = generationMode === "express" ? "Express 5s = 15 jades"
               : durationSec === 15           ? "Standard 15s = 24 jades"
               :                                "Standard 10s = 17 jades";
    const audio = audioMode === "native"             ? " + Audio nativo +6 jades"
                : audioMode === "elevenlabs_lipsync" ? " + Voz ElevenLabs + Lip Sync +8 jades"
                : "";
    return base + audio;
  }

  function getEtaText() {
    if (generationMode === "express") return "Espera estimada: 2-4 min";
    if (audioMode === "elevenlabs_lipsync") return "Espera estimada: 5-10 min (Kling + ElevenLabs + Lip Sync)";
    return durationSec === 15 ? "Espera estimada: 4-8 min" : "Espera estimada: 3-5 min";
  }

  function getFriendlyStatus(providerStatus) {
    const s = String(providerStatus || "").toLowerCase();
    if (s === "kling_processing")       return "🎬 Generando video con Kling...";
    if (s === "elevenlabs_processing")  return "🎙️ Generando voz con ElevenLabs...";
    if (s === "synclipsync_processing") return "👄 Sincronizando labios con Kling Lipsync...";
    return "Procesando...";
  }

  useEffect(() => {
    if (generationMode === "express") setDurationSec(5);
    else if (![10, 15].includes(Number(durationSec))) setDurationSec(10);
  }, [generationMode]);

  // ── Auth headers ──────────────────────────────────────────────
  async function getAuthHeaders() {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || null;
    if (!token) throw new Error("MISSING_AUTH_TOKEN");
    return { Authorization: `Bearer ${token}` };
  }

  async function safeFetchJson(url, options = {}) {
    const r   = await fetch(url, options);
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { j = { ok: false, error: txt?.slice(0, 300) }; }
    return { r, j };
  }

  // ── Imagen ────────────────────────────────────────────────────
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  async function compressImageFile(file, maxWidth = 1280, quality = 0.82) {
    const original = await fileToBase64(file);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale  = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("No se pudo cargar la imagen."));
      img.src = original;
    });
  }

  const processFile = async (file) => {
    try {
      const compressed = await compressImageFile(file);
      setDataUrl(compressed);
      setPureB64(compressed.split(",")[1] || null);
      setImageUrl(""); setError("");
    } catch { setError("No se pudo comprimir la imagen."); }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const isSafe = await checkImageSafety(file);
    if (!isSafe) { setError("La imagen fue bloqueada por contenido inapropiado."); return; }
    setPendingPhotoFile(file);
    setShowPhotoConsent(true);
  };

  // ── Polling ───────────────────────────────────────────────────
  function stopPolling() {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    if (progTimerRef.current) { clearInterval(progTimerRef.current); progTimerRef.current = null; }
  }
  function clearPersistedJob() { try { localStorage.removeItem(STORAGE_KEY); } catch {} }

  function isFetchDisconnectError(e) {
    const m = String(e?.message || "").toLowerCase();
    return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed");
  }

  function setErrorState(msg) { setStatus("ERROR"); setStatusText("Error."); setError(msg || "Ocurrió un error."); }

  async function pollVideoStatus(jid) {
    const auth = await getAuthHeaders();
    const { r, j } = await safeFetchJson(`/api/video-status?job_id=${encodeURIComponent(jid)}`, { headers: auth });
    if (!r.ok || !j) throw new Error(j?.error || "error en video-status");
    return j;
  }

  async function refreshStatusOnce(overrideJobId = null) {
    const jid = overrideJobId || jobId;
    if (!jid) return;
    try {
      setNeedsManualRefresh(false); setError("");
      const stData = await pollVideoStatus(jid);
      const st = String(stData?.status || "IN_PROGRESS").toUpperCase();
      if (stData?.job) setLastKnownJob(stData.job);

      if (["DONE","COMPLETED","SUCCESS","FINISHED"].includes(st)) {
        const url = stData?.video_url || null;
        if (url) setVideoUrl(url);
        setStatus("DONE"); setStatusText("Video listo."); setProgress(100);
        stopPolling(); clearPersistedJob(); return;
      }
      if (["FAILED","ERROR"].includes(st)) {
        setStatus("FAILED"); setStatusText("Falló.");
        setError(stData?.error || "La generación falló.");
        setProgress(0); stopPolling(); clearPersistedJob(); return;
      }

      const providerStatus = stData?.job?.provider_status || "";
      setStatus("IN_PROGRESS");
      setStatusText(getFriendlyStatus(providerStatus));

      // Avanzar barra de progreso estimada
      const startedAt = stData?.job?.started_at || lastKnownJob?.started_at || null;
      if (startedAt) {
        const elapsed  = (Date.now() - new Date(startedAt).getTime()) / 1000;
        const expected = generationMode === "express" ? 180 : durationSec === 15 ? 600 : 360;
        const t = Math.min(0.92, elapsed / expected);
        setProgress((p) => Math.max(p, Math.round(3 + t * 89)));
      }
    } catch (e) {
      if (isFetchDisconnectError(e)) {
        setNeedsManualRefresh(true); setStatus("IN_PROGRESS");
        setError('Conexión perdida. Haz clic en "Actualizar estado".');
      } else { setErrorState(e?.message || String(e)); }
    }
  }

  function startPolling(jid) {
    stopPolling();
    let tick = 0;
    pollTimerRef.current = setInterval(async () => {
      tick += 1;
      if (needsManualRefresh) return;
      if (tick <= 10 || tick % 3 === 0) await refreshStatusOnce(jid);
    }, 3000);
  }

  function hardResetPanel() {
    stopPolling();
    setStatus("IDLE"); setStatusText(""); setJobId(null); setVideoUrl(null);
    setError(""); setProgress(0); setNeedsManualRefresh(false); setLastKnownJob(null);
    clearPersistedJob();
  }

  // ── Persistencia localStorage ─────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const payload = { jobId, status, statusText, progress, needsManualRefresh, lastKnownJob, videoUrl, error, savedAt: new Date().toISOString() };
    try {
      if (payload.jobId || payload.videoUrl || ["IN_PROGRESS","STARTING"].includes(payload.status))
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, [user?.id, jobId, status, statusText, progress, needsManualRefresh, lastKnownJob, videoUrl, error, STORAGE_KEY]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.jobId && !saved?.videoUrl) { localStorage.removeItem(STORAGE_KEY); return; }
      if (["FAILED","ERROR"].includes(saved?.status)) { localStorage.removeItem(STORAGE_KEY); return; }
      const savedAt = saved?.savedAt ? new Date(saved.savedAt).getTime() : null;
      if (savedAt && Date.now() - savedAt > 1000 * 60 * 60 * 2) { localStorage.removeItem(STORAGE_KEY); return; }
      if (saved?.jobId)    setJobId(saved.jobId);
      if (saved?.status)   setStatus(saved.status);
      if (saved?.videoUrl) setVideoUrl(saved.videoUrl);
      if (typeof saved?.progress === "number") setProgress(saved.progress);
      if (saved?.jobId && ["IN_PROGRESS","STARTING"].includes(saved?.status)) {
        setTimeout(() => startPolling(saved.jobId), 300);
      }
    } catch { try { localStorage.removeItem(STORAGE_KEY); } catch {} }
  }, [user?.id]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && jobId) refreshStatusOnce(jobId); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [jobId]);

  useEffect(() => () => stopPolling(), []);

  // ── Generar ───────────────────────────────────────────────────
  async function handleGenerate() {
    if (lockRef.current) return;
    lockRef.current = true;
    try {
      setError(""); setVideoUrl(null); setProgress(0); setNeedsManualRefresh(false); setLastKnownJob(null);
      if (!user)      return setErrorState("Debes iniciar sesión.");
      if (!hasEnough) return setErrorState(`Necesitas ${COST_I2V} jades para este video.`);
      if (!pureB64 && !imageUrl) return setErrorState("Sube una imagen o pega una URL.");
      if (audioMode === "elevenlabs_lipsync" && !narrationText.trim())
        return setErrorState("Escribe el texto que dirá el personaje para activar el lip sync.");

      const finalPrompt = FORCED_PREFIX + (prompt.trim() || "Animate this image naturally with subtle realistic motion.");

      setStatus("STARTING"); setStatusText("Enviando trabajo...");
      const auth = await getAuthHeaders();

      const payload = {
        prompt:          finalPrompt,
        negative_prompt: negative.trim() || "blurry, low quality, deformed, text, watermark",
        generation_mode: generationMode,
        duration_s:      durationSec,
        aspect_ratio:    useNineSixteen ? "9:16" : "16:9",
        audio_mode:      audioMode,
        image_b64:       pureB64 || null,
        image_url:       imageUrl || null,
        narration_text:  audioMode === "elevenlabs_lipsync" ? narrationText.trim() : "",
        voice_accent:    voiceAccent,
        voice_gender:    voiceGender,
      };

      const { r, j } = await safeFetchJson("/api/generate-img2video", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify(payload),
      });

      if (!r.ok || !j?.ok || !j?.job_id) throw new Error(j?.error || "No se pudo crear el trabajo.");

      const jid = j.job_id;
      setJobId(jid); setStatus("IN_PROGRESS"); setStatusText("Generando video con Kling..."); setProgress(3);
      startPolling(jid);
    } catch (e) {
      if (isFetchDisconnectError(e)) {
        setNeedsManualRefresh(true); setStatus("IN_PROGRESS");
        setError('Conexión perdida. Haz clic en "Actualizar estado".');
      } else { setErrorState(e?.message || String(e)); }
    } finally { lockRef.current = false; }
  }

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl; a.download = "isabelaos-video.mp4";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  if (!user) return (
    <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-yellow-100">
      Debes iniciar sesión para usar Imagen → Video.
    </div>
  );

  return (
    <>
      {/* ══ MODAL CONSENTIMIENTO ══════════════════════════════════ */}
      {showPhotoConsent && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-cyan-500/10 to-fuchsia-500/10 border-b border-white/10 p-5">
              <h3 className="text-lg font-bold text-white">📸 Consentimiento de imagen</h3>
              <p className="mt-1 text-xs text-neutral-400">Confirma lo siguiente antes de continuar:</p>
            </div>
            <div className="p-5 space-y-3 text-sm text-neutral-300">
              {[
                "Soy titular de los derechos de esta fotografía o tengo el consentimiento de quien aparece.",
                "No usaré esta imagen para suplantar identidades ni causar daño.",
                "Asumo toda la responsabilidad por el contenido generado.",
              ].map((t, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-xl border border-white/10 bg-white/3">
                  <span className="text-cyan-400 mt-0.5 flex-shrink-0">☑</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <div className="p-5 pt-0 flex gap-3">
              <button onClick={async () => { setShowPhotoConsent(false); if (pendingPhotoFile) { await processFile(pendingPhotoFile); setPendingPhotoFile(null); } }}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-black font-bold text-sm rounded-2xl py-3 hover:opacity-90">
                ✓ Acepto y subo la imagen
              </button>
              <button onClick={() => { setShowPhotoConsent(false); setPendingPhotoFile(null); }}
                className="border border-white/15 text-neutral-400 text-sm rounded-2xl px-5 py-3 hover:bg-white/5">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* ── Panel izquierdo ────────────────────────────────────── */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Imagen → Video</h2>
            <button onClick={() => setShowModuleInfo(true)}
              className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/15">
              Sobre este módulo
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-yellow-400/20 bg-yellow-500/5 px-4 py-3 text-[12px] text-yellow-200">
            <span className="font-semibold text-yellow-100">⚠️ Importante:</span>{" "}
            Al subir una fotografía declaras que posees los derechos o tienes el consentimiento de quien aparece.
          </div>

          {/* Estado y Jades */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-xs text-neutral-300">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Estado: {statusText || "Listo."}</span>
              <span>Jades: <span className="font-semibold text-white">{userStatus?.jades ?? "..."}</span></span>
            </div>
            <div className="mt-1 text-[11px] font-semibold text-red-400">{getPriceText()}</div>
            {jobId && <div className="mt-1 text-[10px] text-neutral-500">Job: {jobId}</div>}

            {["IN_PROGRESS","STARTING","DONE"].includes(status) && (
              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-neutral-400">
                  <span>Progreso</span><span>{Math.min(100, progress)}%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all"
                    style={{ width: `${Math.min(100, progress)}%` }} />
                </div>
                <div className="mt-2 text-[11px] text-neutral-300">{getEtaText()}</div>
                {needsManualRefresh && <div className="mt-1 text-[11px] text-yellow-200">Conexión perdida. Haz clic en "Actualizar estado".</div>}
              </div>
            )}

            {jobId && ["IN_PROGRESS","ERROR"].includes(status) && (
              <button onClick={() => refreshStatusOnce(jobId)}
                className="mt-3 w-full rounded-xl border border-white/20 px-3 py-2 text-[11px] text-white hover:bg-white/10">
                Actualizar estado
              </button>
            )}
            <button onClick={hardResetPanel}
              className="mt-2 w-full rounded-xl border border-red-400/30 px-3 py-2 text-[11px] text-red-300 hover:bg-red-500/10">
              Reiniciar panel
            </button>
          </div>

          {/* Modo y Duración */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-xs text-neutral-300">Modo</div>
              <div className="mt-3 space-y-2">
                {[["express","Express"],["standard","Standard"]].map(([v,l]) => (
                  <label key={v} className="flex items-center gap-2 text-[12px] text-neutral-200">
                    <input type="radio" name="i2v_mode" checked={generationMode === v} onChange={() => setGenerationMode(v)} className="h-4 w-4" />
                    {l}
                  </label>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-neutral-500">
                {generationMode === "express" ? "Kling 2.1 pro · 5s" : "Kling 2.1 std · 10s / Kling 3.0 pro · 15s"}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-xs text-neutral-300">Formato</div>
              <div className="mt-3 flex items-center gap-2">
                <input id="i2v_916" type="checkbox" checked={useNineSixteen} onChange={e => setUseNineSixteen(e.target.checked)} className="h-4 w-4" />
                <label htmlFor="i2v_916" className="text-[12px] text-neutral-200">Vertical 9:16</label>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/50 px-4 py-3">
              <div className="text-xs text-neutral-300">Duración</div>
              <div className="mt-3 space-y-2">
                {generationMode === "express"
                  ? <div className="text-[12px] text-neutral-400">5s (fijo)</div>
                  : [10, 15].map(s => (
                    <label key={s} className="flex items-center gap-2 text-[12px] text-neutral-200">
                      <input type="radio" name="i2v_dur" checked={durationSec === s} onChange={() => setDurationSec(s)} className="h-4 w-4" />
                      {s} segundos
                    </label>
                  ))
                }
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-4 text-sm">
            {/* Imagen */}
            <div>
              <p className="text-xs text-neutral-300">1. Sube una imagen</p>
              <button onClick={() => document.getElementById(fileInputId)?.click()}
                className="mt-2 flex h-40 w-full items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/50 text-sm text-neutral-300 hover:bg-white/5">
                {dataUrl ? "Cambiar imagen" : "Haz clic para subir una imagen"}
              </button>
              <input id={fileInputId} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              {dataUrl && <div className="mt-3 overflow-hidden rounded-2xl border border-white/10"><img src={dataUrl} alt="Base" className="w-full object-cover" /></div>}
            </div>

            <div>
              <p className="text-xs text-neutral-300">o pega una URL de imagen</p>
              <input type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..."
                className="mt-2 w-full rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10" />
            </div>

            <div>
              <label className="text-neutral-300">Prompt (opcional)</label>
              <textarea className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={prompt} onChange={e => setPrompt(e.target.value)}
                placeholder="Describe movimiento, cámara, ambiente..." />
            </div>

            <div>
              <label className="text-neutral-300">Negativo (opcional)</label>
              <textarea className="mt-1 h-14 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10"
                value={negative} onChange={e => setNegative(e.target.value)} placeholder="borroso, baja calidad..." />
            </div>

            {/* ── Opciones de audio ─────────────────────────────── */}
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4 space-y-3">
              <div className="text-xs font-semibold text-white">🔊 Audio</div>

              {[
                { value: "none",              label: "Sin audio",                             sub: "Video mudo" },
                { value: "native",            label: "Audio nativo de Kling  +6 jades",      sub: "Kling genera voz y sonidos automáticamente" },
                { value: "elevenlabs_lipsync",label: "Voz ElevenLabs + Lip Sync  +8 jades",  sub: "Voz latina personalizada + labios sincronizados (Kling)" },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${audioMode === opt.value ? "border-cyan-400/50 bg-cyan-500/10" : "border-white/10 bg-black/30 hover:bg-white/5"}`}>
                  <input type="radio" name="audio_mode" checked={audioMode === opt.value} onChange={() => setAudioMode(opt.value)} className="h-4 w-4 mt-0.5" />
                  <div>
                    <div className="text-[12px] font-medium text-white">{opt.label}</div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">{opt.sub}</div>
                  </div>
                </label>
              ))}

              {/* Campos ElevenLabs cuando se selecciona lipsync */}
              {audioMode === "elevenlabs_lipsync" && (
                <div className="mt-2 space-y-3 pt-2 border-t border-white/10">
                  <div>
                    <label className="text-[11px] text-neutral-400">Texto que dirá el personaje</label>
                    <textarea
                      className="mt-1 h-20 w-full resize-none rounded-2xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-cyan-400"
                      value={narrationText}
                      onChange={e => setNarrationText(e.target.value)}
                      placeholder="Escribe lo que el personaje debe decir..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-neutral-400">Acento / Región</label>
                      <select value={voiceAccent} onChange={e => setVoiceAccent(e.target.value)}
                        className="mt-1 w-full rounded-xl bg-black/60 px-3 py-2 text-xs text-white outline-none ring-1 ring-white/10">
                        {ACCENTS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-neutral-400">Género de voz</label>
                      <div className="mt-2 space-y-2">
                        {[["mujer","Femenina"],["hombre","Masculina"]].map(([v,l]) => (
                          <label key={v} className="flex items-center gap-2 text-[12px] text-neutral-200">
                            <input type="radio" name="voice_gender" checked={voiceGender === v} onChange={() => setVoiceGender(v)} className="h-4 w-4" />
                            {l}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-yellow-400/20 bg-yellow-500/5 px-3 py-2 text-[10px] text-yellow-200">
                    ⏱️ Proceso: Kling genera video → ElevenLabs crea voz → Kling sincroniza labios. Tarda 5-10 min.
                  </div>
                </div>
              )}
            </div>

            {/* Resumen de precio */}
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-[11px] text-cyan-100">
              <div className="font-semibold text-white">Resumen</div>
              <div className="mt-1 text-red-400 font-semibold">{getPriceText()}</div>
              <div className="mt-0.5 text-neutral-400">
                Precios: Express 5s=15j · Std 10s=17j · Std 15s=24j · Audio nativo+6j · ElevenLabs+Lipsync+8j
              </div>
            </div>

            {/* Botón generar */}
            <button onClick={handleGenerate}
              disabled={["STARTING","IN_PROGRESS"].includes(status) || !hasEnough}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-50">
              {["STARTING","IN_PROGRESS"].includes(status)
                ? "Generando..."
                : !hasEnough
                  ? `Necesitas ${COST_I2V} jades`
                  : `Generar video ${generationMode === "express" ? "Express" : "Standard"}`}
            </button>

            {error && <p className="whitespace-pre-line text-xs text-red-400">{error}</p>}
          </div>
        </div>

        {/* ── Panel derecho: resultado ─────────────────────────── */}
        <div className="flex flex-col rounded-3xl border border-white/10 bg-black/40 p-6">
          <h2 className="text-lg font-semibold text-white">Resultado</h2>
          <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400">
            {videoUrl
              ? <video src={videoUrl} controls className="h-full w-full rounded-2xl object-contain" />
              : <p>Aquí verás el video cuando termine.</p>}
          </div>
          {videoUrl && (
            <button onClick={handleDownload} className="mt-4 w-full rounded-2xl border border-white/30 py-2 text-xs text-white hover:bg-white/10">
              Descargar video
            </button>
          )}
        </div>
      </div>

      {/* ── Modal: Sobre este módulo ────────────────────────────── */}
      {showModuleInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="relative w-full max-w-3xl rounded-3xl border border-white/10 bg-[#05070d] p-5 shadow-2xl">
            <button onClick={() => setShowModuleInfo(false)}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-lg text-white hover:bg-white/10">✕</button>
            <h3 className="text-xl font-semibold text-white pr-12">Sobre este módulo</h3>
            <p className="mt-1 text-sm text-neutral-300">Convierte una imagen en video usando Kling AI vía PiAPI.</p>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-neutral-300 space-y-2">
              <p><span className="font-semibold text-cyan-300">Express:</span> Kling 2.1 pro · 5s · mejor calidad rápida.</p>
              <p><span className="font-semibold text-cyan-300">Standard 10s:</span> Kling 2.1 std · equilibrio precio/calidad.</p>
              <p><span className="font-semibold text-cyan-300">Standard 15s:</span> Kling 3.0 pro · clips más largos.</p>
              <div className="pt-2 border-t border-white/10">
                <p className="font-semibold text-white">Opciones de audio:</p>
                <p><span className="text-white font-medium">Sin audio:</span> video mudo, el más económico.</p>
                <p><span className="text-white font-medium">Audio nativo (+6j):</span> Kling genera voz y sonido automáticamente desde el prompt.</p>
                <p><span className="text-white font-medium">ElevenLabs + Lip Sync (+8j):</span> voz latina personalizada con labios sincronizados. Tarda 5-10 min.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
