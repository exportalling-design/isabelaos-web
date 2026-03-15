import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function MontajeIAPanel({ userStatus }) {
  const UI_COST_JADES_DEFAULT = 8;

  const [status, setStatus] = useState("IDLE"); // IDLE | RUNNING | DONE | ERROR
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");

  const [personFile, setPersonFile] = useState(null);
  const [personPreview, setPersonPreview] = useState("");

  const [backgroundFile, setBackgroundFile] = useState(null);
  const [backgroundPreview, setBackgroundPreview] = useState("");

  const [resultUrl, setResultUrl] = useState("");
  const [jadesLocal, setJadesLocal] = useState(null);

  const [prompt, setPrompt] = useState("");

  // ✅ NUEVO: respuesta y plan de Isabela
  const [isabelaReply, setIsabelaReply] = useState("");
  const [isabelaPlan, setIsabelaPlan] = useState(null);
  const [isabelaLoading, setIsabelaLoading] = useState(false);

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

  function resetInterpretation() {
    setIsabelaReply("");
    setIsabelaPlan(null);
  }

  async function handlePersonFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPersonFile(f);
    setPersonPreview(URL.createObjectURL(f));
    resetRunUI();
    resetInterpretation();
  }

  async function handleBackgroundFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBackgroundFile(f);
    setBackgroundPreview(URL.createObjectURL(f));
    resetRunUI();
    resetInterpretation();
  }

  async function fileToBase64(file) {
    const buf = await file.arrayBuffer();
    return btoa(
      new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function pollJob(jobIdToPoll, maxSeconds = 140) {
    const started = Date.now();

    while (true) {
      if ((Date.now() - started) / 1000 > maxSeconds) {
        throw new Error("Tiempo de espera agotado esperando resultado del montaje.");
      }

      const r = await fetch("/api/montaje-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jobIdToPoll }),
      });

      const data = await r.json().catch(() => null);

      if (!r.ok || !data) {
        throw new Error("Error consultando estado del montaje.");
      }

      if (data.done && data.ok && data.image_data_url) {
        return data.image_data_url;
      }

      if (data.done && !data.ok) {
        throw new Error(data.error || "No se pudo completar el montaje.");
      }

      await sleep(1500);
    }
  }

  // ✅ NUEVO: consultar a Isabela antes de generar
  async function handleAskIsabela() {
    try {
      setIsabelaLoading(true);
      setError("");
      setIsabelaReply("");
      setIsabelaPlan(null);

      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

      if (!token) {
        throw new Error("MISSING_AUTH_TOKEN");
      }

      const resp = await fetch("/api/isabela-montaje-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: prompt,
          hasPersonImage: !!personFile,
          hasBackgroundImage: !!backgroundFile,
        }),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok || !json?.ok) {
        throw new Error(json?.reply || json?.error || "No pude interpretar la solicitud.");
      }

      if (!json.allowed) {
        setIsabelaReply(
          json.reply ||
            "Lo siento, solo puedo ayudarte con funciones relacionadas con este módulo de montaje de imágenes."
        );
        setIsabelaPlan(null);
        return;
      }

      setIsabelaReply(
        json.reply || "Entendido. Si está correcto, da click en Generar montaje."
      );
      setIsabelaPlan(json);
    } catch (err) {
      console.error(err);
      setError("Lo siento, no pude interpretar tu instrucción en este momento.");
    } finally {
      setIsabelaLoading(false);
    }
  }

  async function handleGenerate() {
    if (!personFile) {
      setError("Debes subir una imagen de persona, modelo o producto.");
      return;
    }

    if (!prompt.trim()) {
      setError("Debes escribir una instrucción para Isabela.");
      return;
    }

    try {
      setStatus("RUNNING");
      setError("");
      setResultUrl("");
      setJobId("");

      const person_b64 = await fileToBase64(personFile);
      const bg_b64 = backgroundFile ? await fileToBase64(backgroundFile) : null;

      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

      if (!token) {
        throw new Error("MISSING_AUTH_TOKEN");
      }

      const resp = await fetch("/api/generate-montaje", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          person_image: person_b64,
          background_image: bg_b64,
          prompt,
          isabelaPlan, // ✅ NUEVO: mandar el plan ya confirmado
          ref: `montajeia-${Date.now()}`,
        }),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error || "ERROR_GENERATION");
      }

      if (json?.jobId) setJobId(json.jobId);

      if (json?.billed?.amount) {
        setJadesLocal((prev) => {
          const base =
            typeof prev === "number"
              ? prev
              : typeof userStatus?.jades === "number"
                ? userStatus.jades
                : 0;
          return Math.max(0, base - json.billed.amount);
        });
      }

      // ✅ primero intenta usar imagen directa
      if (json?.image_data_url) {
        setResultUrl(json.image_data_url);
        setStatus("DONE");
        return;
      }

      // ✅ fallback por compatibilidad
      const finalImage = await pollJob(json.jobId, 160);
      setResultUrl(finalImage);
      setStatus("DONE");
    } catch (err) {
      console.error(err);
      setError(
        "Lo siento, no pude generar el montaje. Intenta cambiar las imágenes o la descripción."
      );
      setStatus("ERROR");
    }
  }

  function UploadCard({ title, subtitle, preview, onChange }) {
    return (
      <label className="group relative block cursor-pointer overflow-hidden rounded-3xl border border-cyan-400/20 bg-black/40 p-4 transition hover:border-fuchsia-400/40">
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.15),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(217,70,239,0.14),transparent_35%)]" />
        <div className="relative z-10">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs text-neutral-400">{subtitle}</p>

          <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/40 p-6 text-center">
            {!preview ? (
              <>
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-2xl">
                  🖼️
                </div>
                <p className="text-sm font-semibold text-white">Sube foto aquí</p>
                <p className="mt-1 text-xs text-neutral-500">Toca para seleccionar una imagen</p>
              </>
            ) : (
              <img
                src={preview}
                alt="preview"
                className="mx-auto max-h-[260px] w-full rounded-2xl object-cover"
              />
            )}
          </div>
        </div>

        <input type="file" accept="image/*" onChange={onChange} className="hidden" />
      </label>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Montaje IA</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Coloca una persona, producto o avatar dentro de cualquier escenario real.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <UploadCard
          title="Persona / modelo / producto"
          subtitle="Sube la imagen principal que quieres montar."
          preview={personPreview}
          onChange={handlePersonFile}
        />

        <UploadCard
          title="Escenario"
          subtitle="Opcional. Sube un fondo real o deja vacío para que Isabela lo interprete."
          preview={backgroundPreview}
          onChange={handleBackgroundFile}
        />
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-cyan-400/25 bg-black/50 p-5 shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_0_24px_rgba(34,211,238,0.08),0_0_42px_rgba(217,70,239,0.06)]">
        <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_28%),radial-gradient(circle_at_bottom,rgba(217,70,239,0.10),transparent_28%)]" />
        <div className="relative z-10 mx-auto max-w-4xl">
          <div className="mb-4 text-center">
            <p className="text-xl font-semibold text-white">Hola, soy Isabela.</p>
            <p className="mt-2 text-sm text-neutral-400">
              Cuéntame cómo quieres montar tu imagen.
            </p>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              // ✅ si cambian el prompt, invalida confirmación previa
              setIsabelaPlan(null);
              setIsabelaReply("");
            }}
            placeholder="Ej: monta a la modelo caminando dentro de una tienda elegante, con luz natural y un look realista..."
            className="min-h-[140px] w-full rounded-2xl border border-white/10 bg-black/60 px-4 py-4 text-sm text-white outline-none placeholder:text-neutral-500"
          />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleAskIsabela}
              disabled={isabelaLoading || !prompt.trim()}
              className="rounded-2xl border border-cyan-400/30 bg-black/40 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isabelaLoading ? "Isabela está pensando..." : "Consultar a Isabela"}
            </button>

            <button
              onClick={handleGenerate}
              disabled={status === "RUNNING" || !prompt.trim() || !personFile}
              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
            >
              {status === "RUNNING" ? "Generando..." : `Generar montaje (-${UI_COST_JADES_DEFAULT})`}
            </button>
          </div>

          {isabelaReply ? (
            <div className="mt-4 rounded-2xl border border-fuchsia-500/20 bg-black/40 p-4 text-sm text-neutral-200">
              <p className="mb-2 font-semibold text-white">Isabela</p>
              <p>{isabelaReply}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-black/40 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-neutral-400">Costo por generación</p>
          <p className="text-2xl font-bold text-white">{UI_COST_JADES_DEFAULT} jades</p>
          <p className="mt-1 text-xs text-neutral-500">
            Jades disponibles: {jadesShown}
          </p>
        </div>

        <div className="text-sm text-neutral-400">
          Consulta con Isabela y cuando esté correcto, genera el montaje.
        </div>
      </div>

      {jobId ? (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-neutral-300">
          Job: <span className="font-semibold text-white">{jobId}</span>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <p className="text-lg font-semibold text-white">Resultado</p>

        {!resultUrl ? (
          <p className="mt-3 text-sm text-neutral-400">
            Aquí aparecerá el montaje {status === "RUNNING" ? "(procesando...)" : ""}
          </p>
        ) : (
          <img
            src={resultUrl}
            className="mt-4 w-full rounded-2xl border border-white/10"
            alt="resultado"
          />
        )}
      </div>
    </div>
  );
}
