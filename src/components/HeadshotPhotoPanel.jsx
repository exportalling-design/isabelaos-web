import { useMemo, useState } from "react";

export default function HeadshotProPanel({ userStatus }) {
  const COST_JADES = 5;

  const [imageUrl, setImageUrl] = useState("");
  const [status, setStatus] = useState("IDLE"); // IDLE | RUNNING | DONE | ERROR
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");

  // Para reflejar el cobro inmediatamente en UI sin depender de refetch
  const [jadesLocal, setJadesLocal] = useState(null);

  const jadesShown = useMemo(() => {
    const base = typeof userStatus?.jades === "number" ? userStatus.jades : 0;
    return typeof jadesLocal === "number" ? jadesLocal : base;
  }, [userStatus?.jades, jadesLocal]);

  async function urlToBase64(url) {
    // Descarga la imagen desde URL y conviértela a base64 (dataURL)
    // Nota: si la URL no permite CORS, esto fallará. Para eso lo ideal es que el backend haga el fetch.
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) throw new Error("No pude descargar la imagen desde la URL (CORS o URL inválida).");

    const blob = await resp.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error("La URL no parece ser una imagen válida.");
    }

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); // data:image/...;base64,....
      reader.onerror = () => reject(new Error("Error convirtiendo imagen a base64."));
      reader.readAsDataURL(blob);
    });
  }

  const run = async () => {
    setError("");
    setResultUrl("");
    setJobId("");
    setStatus("RUNNING");

    try {
      if (!imageUrl) throw new Error("Pega una URL de imagen.");

      // Convertimos URL -> dataURL base64
      const dataUrl = await urlToBase64(imageUrl);

      // Extraemos solo el b64 (sin prefijo), porque tu backend/worker usa image_b64 puro
      const b64 = String(dataUrl).includes("base64,")
        ? String(dataUrl).split("base64,")[1]
        : "";

      if (!b64) throw new Error("No pude extraer base64 de la imagen.");

      const r = await fetch("/api/generate-headshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Tu backend espera image_b64 (no imageUrl)
        body: JSON.stringify({
          image_b64: b64,
          style: "corporate",
          ref: `headshotpro-${Date.now()}`, // opcional para trazabilidad en spend_jades
          // opcionales (si tu worker los usa):
          strength: 0.2,
          steps: 20,
          guidance: 5.0,
          max_side: 768,
        }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "Headshot error");

      // ✅ Cobro visual SOLO si el backend confirmó billing / ok
      // (el cobro real lo hace el backend con spend_jades)
      if (data?.billed?.type === "JADE") {
        const current = typeof jadesShown === "number" ? jadesShown : 0;
        setJadesLocal(Math.max(0, current - (data.billed.amount ?? COST_JADES)));
      } else {
        // si tu backend no manda billed aún, igual reflejamos el costo configurado en UI
        const current = typeof jadesShown === "number" ? jadesShown : 0;
        setJadesLocal(Math.max(0, current - COST_JADES));
      }

      // ✅ Soporte para 3 tipos de respuesta:
      // 1) worker devuelve image_data_url (ideal)
      // 2) worker devuelve image_b64 (armamos data URL)
      // 3) backend solo devuelve jobId (no hay imagen aún)
      const outDataUrl =
        data?.image_data_url ||
        data?.output?.image_data_url ||
        "";

      const outB64 =
        data?.image_b64 ||
        data?.output?.image_b64 ||
        "";

      if (outDataUrl) {
        setResultUrl(outDataUrl);
        setStatus("DONE");
        return;
      }

      if (outB64) {
        // asumimos jpeg para evitar problemas; si tu backend manda mime, úsalo.
        const mime = data?.mime || data?.output?.mime || "image/jpeg";
        setResultUrl(`data:${mime};base64,${outB64}`);
        setStatus("DONE");
        return;
      }

      // Si no viene imagen, al menos mostramos jobId
      if (data?.jobId) {
        setJobId(data.jobId);
        setStatus("DONE");
        return;
      }

      // Si no vino nada útil, marcamos error para no mostrar “negro”
      throw new Error("El backend respondió OK pero no devolvió imagen ni jobId.");
    } catch (e) {
      setStatus("ERROR");
      setError(e?.message || "Error");
    }
  };

  return (
    <section className="rounded-3xl border border-white/10 bg-black/60 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Headshot Pro</h2>
          <p className="text-xs text-neutral-400">
            Premium · Costo: <span className="text-white font-semibold">{COST_JADES}</span>{" "}
            jades · Jades actuales:{" "}
            <span className="text-white font-semibold">{jadesShown}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="text-xs text-neutral-300">URL de foto (producto)</label>
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
          {status === "RUNNING" ? "Generando..." : `Generar (−${COST_JADES} jades)`}
        </button>

        {error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        {jobId ? (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-neutral-200">
            Job lanzado: <span className="text-white font-semibold">{jobId}</span>
            <div className="text-neutral-400 mt-1">
              (Tu backend devolvió jobId pero no devolvió imagen. Si querés ver la imagen aquí, el backend debe esperar el resultado
              o implementar un status endpoint y polling.)
            </div>
          </div>
        ) : null}

        {resultUrl ? (
          <div className="mt-2 rounded-2xl border border-white/10 bg-black/40 p-3">
            <p className="text-xs text-neutral-400 mb-2">Resultado</p>
            <img
              src={resultUrl}
              alt="resultado"
              className="w-full rounded-2xl border border-white/10"
              onError={() => {
                setError("El navegador no pudo renderizar la imagen (base64 inválido o truncado).");
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
