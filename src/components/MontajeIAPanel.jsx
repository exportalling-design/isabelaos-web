import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function MontajeIAPanel({ userStatus }) {
  const UI_COST_JADES_DEFAULT = 8;

  const [personFile, setPersonFile] = useState(null);
  const [personPreview, setPersonPreview] = useState("");

  const [backgroundFile, setBackgroundFile] = useState(null);
  const [backgroundPreview, setBackgroundPreview] = useState("");

  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "isabela",
      text: "Hola. Soy Isabela. Cuéntame cómo quieres montar tu imagen.",
    },
  ]);

  const [isabelaPlan, setIsabelaPlan] = useState(null);
  const [isabelaLoading, setIsabelaLoading] = useState(false);

  function cleanReply(text) {
    if (!text) return "";
    return text.replace(/```json|```/g, "").trim();
  }

  function handlePersonFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPersonFile(f);
    setPersonPreview(URL.createObjectURL(f));
  }

  function handleBackgroundFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBackgroundFile(f);
    setBackgroundPreview(URL.createObjectURL(f));
  }

  async function fileToBase64(file) {
    const buf = await file.arrayBuffer();
    return btoa(
      new Uint8Array(buf).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );
  }

  async function handleAskIsabela() {
    const text = prompt.trim();
    if (!text) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setIsabelaLoading(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

      const resp = await fetch("/api/isabela-montaje-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          hasPersonImage: !!personFile,
          hasBackgroundImage: !!backgroundFile,
        }),
      });

      const json = await resp.json();

      // 🔥 FIX REAL: evita que salga el JSON completo
      let reply = "";
      if (typeof json === "object") {
        reply = json?.reply || "";
      } else {
        reply = json;
      }

      reply = cleanReply(reply);

      setMessages((prev) => [
        ...prev,
        { role: "isabela", text: reply },
      ]);

      if (json?.allowed) setIsabelaPlan(json);

      setPrompt("");
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "isabela", text: "Error al responder." },
      ]);
    } finally {
      setIsabelaLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAskIsabela();
    }
  }

  async function handleGenerate() {
    if (!personFile) {
      alert("Sube imagen principal");
      return;
    }

    try {
      const person_b64 = await fileToBase64(personFile);
      const bg_b64 = backgroundFile
        ? await fileToBase64(backgroundFile)
        : null;

      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

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
        }),
      });

      const json = await resp.json();

      console.log("RESULTADO:", json);
    } catch (err) {
      console.error(err);
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
                <p className="mt-1 text-xs text-neutral-500">
                  Toca para seleccionar una imagen
                </p>
              </>
            ) : (
              <img
                src={preview}
                className="mx-auto max-h-[260px] w-full rounded-2xl object-cover"
              />
            )}
          </div>
        </div>

        <input type="file" accept="image/*" onChange={onChange} className="hidden" />
      </label>
    );
  }

  function MessageBubble({ role, text }) {
    const isUser = role === "user";
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
            isUser
              ? "bg-cyan-500/10 border border-cyan-400/20 text-white"
              : "bg-fuchsia-500/10 border border-fuchsia-400/20 text-white"
          }`}
        >
          <p className="text-xs opacity-70 mb-1">
            {isUser ? "Tú" : "Isabela"}
          </p>
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      <div className="grid gap-6 md:grid-cols-2">
        <UploadCard
          title="Persona / modelo / producto"
          subtitle="Sube la imagen principal que quieres montar."
          preview={personPreview}
          onChange={handlePersonFile}
        />

        <UploadCard
          title="Escenario"
          subtitle="Opcional. Sube un fondo real o deja vacío."
          preview={backgroundPreview}
          onChange={handleBackgroundFile}
        />
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40">
        <div className="h-[320px] overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <MessageBubble key={i} {...m} />
          ))}
        </div>

        <div className="border-t border-white/10 p-3 flex gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ej: colócala en la playa con sombra suave..."
            className="flex-1 min-h-[80px] rounded-2xl bg-black/60 px-4 py-3 text-white outline-none"
          />

          <button
            onClick={handleAskIsabela}
            className="px-5 rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 text-white"
          >
            Enviar
          </button>
        </div>
      </div>

      {/* 🔥 BOTÓN QUE TE FALTABA */}
      <button
        onClick={handleGenerate}
        disabled={!personFile}
        className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 text-white font-semibold"
      >
        Generar montaje (-8 jades)
      </button>
    </div>
  );
}
