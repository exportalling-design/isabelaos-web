import { useMemo, useRef, useState } from "react";

export default function HeadshotProPanel({ userStatus }) {
  const COST_JADES = 5;

  const fileRef = useRef(null);

  const [fileObj, setFileObj] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");

  const [status, setStatus] = useState("IDLE"); // IDLE | RUNNING | DONE | ERROR
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");
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
  }

  function onPickFile(e) {
    resetRunUI();
    const f = e.target.files?.[0] || null;
    if (!f) return;

    if (!f.type.startsWith("image/")) {
      setError("Ese archivo no parece una imagen.");
      setFileObj(null);
      setPreviewUrl("");
      return;
    }

    setFileObj(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
  }

  async function fileToBase64(file) {
    // devuelve SOLO el b64 (sin data:image/...;base64,)
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        const b64 = dataUrl.includes("base64,") ? dataUrl.split("base64,")[1] : "";
        if (!b64) return reject(new Error("No pude extraer base64 de la imagen."));
        resolve(b64);
      };
      reader.onerror = () => reject(new Error("Error leyendo la imagen."));
      reader.readAsDataURL(file);
    });
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

      if (data.done && data.image_data_url) {
        return data.image_data_url; // data:image/jpeg;base64,...
      }

      await sleep(1500);
    }
  }

  const run = async () => {
    resetRunUI();
    setStatus("RUNNING");

    try {
      if (!fileObj) throw new Error("Sube una foto primero.");

      const b64 = await fileToBase64(fileObj);

      // Defaults por modo
      const defaults =
        mode === "anime_identity"
          ? { strength: 0.55, steps: 32, guidance: 7.5, max_side: 768 }
          : { strength: 0.38, steps: 30, guidance: 6.5, max_side: 768 };

      const r = await fetch("/api/generate-headshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: b64,
          mode,
          ref: `headshotpro-${mode}-${Date.now()}`,

          // ✅ prompt libre (si va vacío, el worker usa su prompt default)
          prompt: (prompt || "").trim(),

          ...defaults,
        }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "Error");

      if (!data.jobId) throw new Error("Backend no devolvió jobId.");
      setJobId(data.jobId);

      // UI: reflejar cobro
      const billedAmount = data?.billed?.amount ?? COST_JADES;
      setJadesLocal((prev) => {
        const base =
          typeof prev === "number"
            ? prev
            : typeof userStatus?.jades === "number"
              ? userStatus.jades
              : 0;
        return Math.max(0, base - billedAmount);
      });

      const imgDataUrl = await pollJob(data.jobId, 160);
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
            Premium · Costo: <span className="text-white font-semibold">{COST_JADES}</span> jades · Jades actuales:{" "}
            <span className="text-white font-semibold">{jadesShown}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {/* ✅ Upload como antes */}
        <label className="text-xs text-neutral-300">Sube tu foto</label>
        <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onPickFile}
            className="w-full text-xs text-neutral-200"
          />

          {previewUrl ? (
            <div className="mt-3">
              <p className="text-xs text-neutral-400 mb-2">Vista previa</p>
              <img src={previewUrl} alt="preview" className="w-full rounded-2xl border border-white/10" />
            </div>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">Ej: foto de producto o rostro (mejor si está bien iluminada).</p>
          )}
        </div>

        {/* modo */}
        <label className="text-xs text-neutral-300 mt-2">Modo</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
        >
          <option value="product_studio">Product Studio (Premium)</option>
          <option value="anime_identity">Anime Identity (mantiene rostro)</option>
        </select>

        {/* prompt */}
        <label className="text-xs text-neutral-300 mt-2">Prompt (qué quieres que haga)</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Ej: "foto de producto en estudio, fondo blanco, sombra suave" o "anime limpio, fondo cyberpunk, luz cinematográfica"'
          rows={4}
          className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none resize-none"
        />

        <button
          type="button"
          disabled={!fileObj || status === "RUNNING"}
          onClick={run}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status === "RUNNING" ? "Generando..." : `Generar (−${COST_JADES})`}
        </button>

        {jobId ? (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-neutral-300">
            Job: <span className="text-white font-semibold">{jobId}</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>
        ) : null}

        {resultUrl ? (
          <div className="mt-2 rounded-2xl border border-white/10 bg-black/40 p-3">
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
            <a
              href={resultUrl}
              download="isabelaos_headshot.jpg"
              className="mt-3 inline-block w-full rounded-2xl border border-white/10 bg-black/40 py-2 text-center text-sm text-white hover:bg-white/5"
            >
              Descargar
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
