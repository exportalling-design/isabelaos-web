import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function MontajeInteligentePanel({ userStatus }) {

  const UI_COST_JADES_DEFAULT = 5;

  const [status, setStatus] = useState("IDLE");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");

  const [personFile, setPersonFile] = useState(null);
  const [personPreview, setPersonPreview] = useState("");

  const [backgroundFile, setBackgroundFile] = useState(null);
  const [backgroundPreview, setBackgroundPreview] = useState("");

  const [resultUrl, setResultUrl] = useState("");

  const [jadesLocal, setJadesLocal] = useState(null);

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

  async function handlePersonFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;

    setPersonFile(f);

    const url = URL.createObjectURL(f);
    setPersonPreview(url);

    resetRunUI();
  }

  async function handleBackgroundFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;

    setBackgroundFile(f);

    const url = URL.createObjectURL(f);
    setBackgroundPreview(url);

    resetRunUI();
  }

  async function fileToBase64(file) {
    const buf = await file.arrayBuffer();
    return btoa(
      new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );
  }

  async function handleGenerate() {

    if (!personFile) {
      setError("Debes subir una imagen de persona o producto.");
      return;
    }

    try {

      setStatus("RUNNING");
      setError("");

      const person_b64 = await fileToBase64(personFile);
      const bg_b64 = backgroundFile ? await fileToBase64(backgroundFile) : null;

      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

      const resp = await fetch("/api/montaje-inteligente", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          person_image: person_b64,
          background_image: bg_b64,
          prompt
        })
      });

      const json = await resp.json();

      if (!resp.ok) {
        throw new Error(json?.error || "ERROR_GENERATION");
      }

      if (json?.jobId) setJobId(json.jobId);

      if (json?.image_data_url) {
        setResultUrl(json.image_data_url);
      }

      if (json?.billed?.amount) {
        setJadesLocal(jadesShown - json.billed.amount);
      }

      setStatus("DONE");

    } catch (err) {

      console.error(err);

      setError(
        "Lo siento, no pude generar la imagen. Intenta cambiar la descripción o las imágenes."
      );

      setStatus("ERROR");
    }
  }

  return (
    <div className="space-y-6">

      <div>
        <h1 className="text-xl font-semibold text-white">
          Montaje Inteligente
        </h1>

        <p className="text-xs text-neutral-400 mt-1">
          Coloca una persona, producto o avatar dentro de cualquier escenario real.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">

        {/* PERSONA */}

        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <p className="text-xs text-neutral-300 mb-2">
            Persona / modelo / producto
          </p>

          <input
            type="file"
            accept="image/*"
            onChange={handlePersonFile}
            className="text-xs"
          />

          {personPreview && (
            <img
              src={personPreview}
              className="mt-3 rounded-xl"
              alt="preview"
            />
          )}
        </div>

        {/* FONDO */}

        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <p className="text-xs text-neutral-300 mb-2">
            Escenario (opcional)
          </p>

          <input
            type="file"
            accept="image/*"
            onChange={handleBackgroundFile}
            className="text-xs"
          />

          {backgroundPreview && (
            <img
              src={backgroundPreview}
              className="mt-3 rounded-xl"
              alt="preview"
            />
          )}
        </div>

      </div>

      {/* CHAT ISABELA */}

      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">

        <p className="text-sm text-white mb-2">
          Hola, soy Isabela.
        </p>

        <p className="text-xs text-neutral-400 mb-3">
          Cuéntame cómo quieres montar tu imagen.
        </p>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ej: pon a la modelo caminando en una tienda de ropa elegante..."
          className="w-full rounded-xl bg-black/60 px-3 py-2 text-white text-xs"
          rows={3}
        />

      </div>

      {/* GENERAR */}

      <div className="flex items-center justify-between">

        <button
          onClick={handleGenerate}
          disabled={status === "RUNNING"}
          className="rounded-xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 py-3 px-6 text-white font-semibold disabled:opacity-50"
        >
          {status === "RUNNING" ? "Generando..." : "Generar montaje"}
        </button>

        <p className="text-xs text-neutral-400">
          Jades disponibles: {jadesShown}
        </p>

      </div>

      {error && (
        <p className="text-red-400 text-xs">
          {error}
        </p>
      )}

      {/* RESULTADO */}

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">

        {resultUrl ? (
          <>
            <img
              src={resultUrl}
              className="rounded-xl"
              alt="resultado"
            />
          </>
        ) : (
          <p className="text-neutral-400 text-xs">
            Aquí aparecerá el resultado {status === "RUNNING" ? "(procesando...)" : ""}
          </p>
        )}

      </div>

    </div>
  );
 }
