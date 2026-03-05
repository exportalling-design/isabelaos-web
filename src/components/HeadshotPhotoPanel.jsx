import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function HeadshotPhotoPanel({ userStatus }) {
  // ✅ NO hardcodees esto para cobrar: el backend cobra.
  // Esto es solo UI (se reemplaza por lo que devuelva billed.amount).
  const UI_COST_JADES_DEFAULT = 5;

  const [status, setStatus] = useState("IDLE"); // IDLE | RUNNING | DONE | ERROR
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");

  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");

  const [jadesLocal, setJadesLocal] = useState(null);

  // ✅ modo
  const [mode, setMode] = useState("product_studio"); // product_studio | anime_identity

  // ✅ prompt libre
  const [prompt, setPrompt] = useState("");

  const jadesShown = useMemo(() => {
    const base = typeof userStatus?.jades === "number" ? userStatus.jades : 0;
    return typeof jadesLocal === "number" ? jadesLocal : base;
  }, [userStatus?.jades, jadesLocal]);

  function resetRunUI() {
    setError("");
    setResultUrl("");
    setJobId("");
    setStatus("IDLE");
  }

  function fileToDataURL(f) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("No pude leer el archivo."));
      reader.readAsDataURL(f);
    });
  }

  function dataUrlToB64(dataUrl) {
    const s = String(dataUrl || "");
    const idx = s.indexOf("base64,");
    if (idx === -1) return "";
    return s.slice(idx + "base64,".length);
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function pollJob(jobIdToPoll, maxSeconds = 140) {
    const started = Date.now();
    while (true) {
      if ((Date.now() - started) / 1000 > maxSeconds) {
        throw new Error("Tiempo de espera agotado esperando resultado del job.");
      }

      const r = await fetch("/api/headshot-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jobIdToPoll }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "Error consultando status del job.");

      // ✅ Tu status API normalmente devuelve image_data_url cuando termina
      if (data.done && data.image_data_url) {
        return data.image_data_url; // data:image/jpeg;base64,...
      }

      await sleep(1500);
    }
  }

  async function getAuthTokenOrThrow() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("AUTH_SESSION_ERROR");
    const token = data?.session?.access_token;
    if (!token) throw new Error("MISSING_AUTH_TOKEN");
    return token;
  }

  const onPickFile = async (e) => {
    resetRunUI();

    const f = e.target.files?.[0] || null;
    setFile(f);

    if (!f) {
      setPreviewUrl("");
      return;
    }

    // preview
    const localUrl = URL.createObjectURL(f);
    setPreviewUrl(localUrl);
  };

  const run = async () => {
    setError("");
    setResultUrl("");
    setJobId("");
    setStatus("RUNNING");

    try {
      if (!file) throw new Error("Sube una foto primero.");

      // ✅ Convertimos archivo -> base64 (sin prefix)
      const dataUrl = await fileToDataURL(file);
      const b64 = dataUrlToB64(dataUrl);
      if (!b64) throw new Error("No pude extraer base64 del archivo.");

      // ✅ Defaults por modo (igual que venías usando)
      const defaults =
        mode === "anime_identity"
          ? { strength: 0.55, steps: 32, guidance: 7.5, max_side: 768 }
          : { strength: 0.38, steps: 30, guidance: 6.5, max_side: 768 };

      // ✅ TOKEN SUPABASE (ARREGLA el 401 / MISSING_AUTH_TOKEN)
      const token = await getAuthTokenOrThrow();

      // ✅ Lanza job
      const r = await fetch("/api/generate-headshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          image_b64: b64,
          mode,
          ref: `headshotpro-${mode}-${Date.now()}`,

          // ✅ prompt libre (si está vacío, el worker usa default)
          prompt: (prompt || "").trim(),

          ...defaults,
        }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "Error");

      if (!data.jobId) throw new Error("Backend no devolvió jobId.");
      setJobId(data.jobId);

      // ✅ UI: reflejar cobro REAL (si viene)
      const billedAmount =
        typeof data?.billed?.amount === "number" ? data.billed.amount : UI_COST_JADES_DEFAULT;

      setJadesLocal((prev) => {
        const base =
          typeof prev === "number"
            ? prev
            : typeof userStatus?.jades === "number"
              ? userStatus.jades
              : 0;
        return Math.max(0, base - billedAmount);
      });

      // ✅ Poll hasta resultado
      const imgDataUrl = await pollJob(data.jobId, 140);
      setResultUrl(imgDataUrl);
      setStatus("DONE");
    } catch (e) {
      setStatus("ERROR");
      setError(e?.message || "Error");
    }
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-black/60 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Headshot Pro (Producto)</h2>
          <p className="text-xs text-neutral-400">
            Premium · Costo:{" "}
            <span className="text-white font-semibold">{UI_COST_JADES_DEFAULT}</span> jades · Jades actuales:{" "}
            <span className="text-white font-semibold">{jadesShown}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        {/* ✅ Upload como antes */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-4">
          <label className="block text-xs text-neutral-300 mb-2">Sube tu foto</label>
          <input
            type="file"
            accept="image/*"
            onChange={onPickFile}
            className="w-full rounded-2xl border border-white/10 bg-black/60 px-3 py-3 text-xs text-white"
          />

          {previewUrl ? (
            <div className="mt-3">
              <p className="text-xs text-neutral-400 mb-2">Vista previa</p>
              <img
                src={previewUrl}
                alt="preview"
                className="w-full rounded-2xl border border-white/10"
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-neutral-500">Ej: fondo neutro, luz de estudio</p>
          )}
        </div>

        {/* ✅ Modo */}
        <div>
          <label className="text-xs text-neutral-300">Modo</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
          >
            <option value="product_studio">Product Studio (Premium)</option>
            <option value="anime_identity">Anime Identity (mantiene rostro)</option>
          </select>
        </div>

        {/* ✅ Prompt libre */}
        <div>
          <label className="text-xs text-neutral-300">Prompt (qué quieres que haga)</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='Ej: "caricatura limpia, fondo cyberpunk, luz cinematográfica" o "foto de producto en estudio, fondo blanco, sombra suave"'
            rows={4}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none resize-none"
          />
        </div>

        {/* ✅ Botón */}
        <button
          type="button"
          disabled={!file || status === "RUNNING"}
          onClick={run}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status === "RUNNING" ? "Generando..." : `Generar (−${UI_COST_JADES_DEFAULT})`}
        </button>

        {/* ✅ Info */}
        {jobId ? (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-neutral-300">
            Job: <span className="text-white font-semibold">{jobId}</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        {/* ✅ Resultado */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-4">
          {resultUrl ? (
            <>
              <p className="text-xs text-neutral-400 mb-2">Resultado</p>
              <img
                src={resultUrl}
                alt="result"
                className="w-full rounded-2xl border border-white/10"
                onError={() => {
                  setError("El navegador no pudo renderizar la imagen (dataURL inválido).");
                  setStatus("ERROR");
                  setResultUrl("");
                }}
              />
            </>
          ) : (
            <p className="text-neutral-400 text-sm">
              Aquí aparecerá el resultado{status === "RUNNING" ? " (procesando...)" : ""}
            </p>
          )}
        </div>
      </div>
    </section>
  );
  }
