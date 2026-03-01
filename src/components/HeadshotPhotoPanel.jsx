import { useMemo, useState } from "react";

export default function HeadshotProPanel({ userStatus }) {
  const COST_JADES = 5;

  const [imageUrl, setImageUrl] = useState("");
  const [status, setStatus] = useState("IDLE"); // IDLE | RUNNING | DONE | ERROR
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");
  const [jadesLocal, setJadesLocal] = useState(null);

  const jadesShown = useMemo(() => {
    const base = typeof userStatus?.jades === "number" ? userStatus.jades : 0;
    return typeof jadesLocal === "number" ? jadesLocal : base;
  }, [userStatus?.jades, jadesLocal]);

  async function urlToBase64(url) {
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) throw new Error("No pude descargar la imagen desde la URL (CORS o URL inválida).");
    const blob = await resp.blob();
    if (!blob.type.startsWith("image/")) throw new Error("La URL no parece ser una imagen válida.");

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); // data:image/...;base64,....
      reader.onerror = () => reject(new Error("Error convirtiendo imagen a base64."));
      reader.readAsDataURL(blob);
    });
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function pollJob(jobIdToPoll, maxSeconds = 90) {
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
        return data.image_data_url;
      }

      // sigue procesando
      await sleep(1500);
    }
  }

  const run = async () => {
    setError("");
    setResultUrl("");
    setJobId("");
    setStatus("RUNNING");

    try {
      if (!imageUrl) throw new Error("Pega una URL de imagen.");

      // URL -> base64
      const dataUrl = await urlToBase64(imageUrl);
      const b64 = String(dataUrl).includes("base64,") ? String(dataUrl).split("base64,")[1] : "";
      if (!b64) throw new Error("No pude extraer base64 de la imagen.");

      // 1) lanzar job
      const r = await fetch("/api/generate-headshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64: b64,
          style: "corporate",
          ref: `headshotpro-${Date.now()}`,
          // opcionales si tu worker los usa:
          strength: 0.2,
          steps: 20,
          guidance: 5.0,
          max_side: 768,
        }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "Headshot error");

      if (!data.jobId) throw new Error("Backend no devolvió jobId.");

      setJobId(data.jobId);

      // reflejar cobro UI (el cobro real ya lo hace tu backend)
      const billedAmount = data?.billed?.amount ?? COST_JADES;
      setJadesLocal((prev) => {
        const base = typeof prev === "number" ? prev : (typeof userStatus?.jades === "number" ? userStatus.jades : 0);
        return Math.max(0, base - billedAmount);
      });

      // 2) polling hasta obtener imagen
      const img = await pollJob(data.jobId, 120);
      setResultUrl(img);
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
        <label className="text-xs text-neutral-300">URL de foto</label>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://..."
          className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none"
        />

        <button
          type="button"
          disabled={!imageUrl || status === "RUNNING"}
          onClick={run}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status === "RUNNING" ? "Generando..." : `Generar Headshot (−${COST_JADES})`}
        </button>

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

        {resultUrl ? (
          <div className="mt-2 rounded-2xl border border-white/10 bg-black/40 p-3">
            <p className="text-xs text-neutral-400 mb-2">Resultado</p>
            <img
              src={resultUrl}
              alt="headshot"
              className="w-full rounded-2xl border border-white/10"
              onError={() => {
                setError("El navegador no pudo renderizar la imagen (dataURL inválido).");
                setStatus("ERROR");
                setResultUrl("");
              }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
        }
