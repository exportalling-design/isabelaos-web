
import { useState } from "react";

export default function HeadshotProPanel({ userStatus }) {
  const [imageUrl, setImageUrl] = useState("");
  const [status, setStatus] = useState("IDLE");
  const [resultUrl, setResultUrl] = useState("");
  const [error, setError] = useState("");

  const run = async () => {
    setError("");
    setResultUrl("");
    setStatus("RUNNING");

    try {
      // Cambiá SOLO esta ruta si tu backend tiene otro nombre
      const r = await fetch("/api/generate-headshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) throw new Error(data?.error || "Headshot error");

      setResultUrl(data.imageUrl || data.url || "");
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
          <h2 className="text-lg font-semibold text-white">Headshot Pro</h2>
          <p className="text-xs text-neutral-400">
            Premium · Jades actuales: <span className="text-white font-semibold">{userStatus?.jades ?? 0}</span>
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
          {status === "RUNNING" ? "Generando..." : "Generar headshot"}
        </button>

        {error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        {resultUrl ? (
          <div className="mt-2 rounded-2xl border border-white/10 bg-black/40 p-3">
            <p className="text-xs text-neutral-400 mb-2">Resultado</p>
            <img src={resultUrl} alt="headshot" className="w-full rounded-2xl border border-white/10" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
