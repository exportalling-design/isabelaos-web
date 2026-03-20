import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function MontajeIAPanel({ userStatus }) {
  const UI_COST_JADES_DEFAULT = 8;

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
  const [isabelaPlan, setIsabelaPlan] = useState(null);
  const [isabelaLoading, setIsabelaLoading] = useState(false);

  const [messages, setMessages] = useState([
    {
      role: "isabela",
      text: "Hola. Soy Isabela. Cuéntame cómo quieres montar tu imagen.",
    },
  ]);

  const jadesShown = useMemo(() => {
    const base = typeof userStatus?.jades === "number" ? userStatus.jades : 0;
    return typeof jadesLocal === "number" ? jadesLocal : base;
  }, [userStatus?.jades, jadesLocal]);

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

    try {
      setIsabelaLoading(true);
      setMessages((prev) => [...prev, { role: "user", text }]);

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

      const replyText = cleanReply(json?.reply);

      setMessages((prev) => [
        ...prev,
        { role: "isabela", text: replyText },
      ]);

      if (json?.allowed) setIsabelaPlan(json);

      setPrompt("");
    } catch (err) {
      setError("Error en el chat");
    } finally {
      setIsabelaLoading(false);
    }
  }

  async function handleGenerate() {
    if (!personFile) {
      setError("Sube una imagen principal");
      return;
    }

    if (!isabelaPlan) {
      setError("Primero confirma la orden con Isabela");
      return;
    }

    try {
      setStatus("RUNNING");

      const person_b64 = await fileToBase64(personFile);
      const bg_b64 = backgroundFile ? await fileToBase64(backgroundFile) : null;

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
          prompt: messages
            .filter((m) => m.role === "user")
            .map((m) => m.text)
            .join(" "),
          isabelaPlan,
        }),
      });

      const json = await resp.json();

      if (json?.image_data_url) {
        setResultUrl(json.image_data_url);
        setStatus("DONE");
      }
    } catch {
      setError("Error generando imagen");
    }
  }

  function MessageBubble({ role, text }) {
    const isUser = role === "user";
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div className="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-black/40 border border-white/10 text-white">
          <b>{isUser ? "Tú" : "Isabela"}:</b> {text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* SUBIDA */}
      <div className="grid md:grid-cols-2 gap-4">
        <label className="border p-4 rounded-xl cursor-pointer">
          {personPreview ? (
            <img src={personPreview} className="rounded-lg" />
          ) : (
            "Subir persona"
          )}
          <input type="file" hidden onChange={handlePersonFile} />
        </label>

        <label className="border p-4 rounded-xl cursor-pointer">
          {backgroundPreview ? (
            <img src={backgroundPreview} className="rounded-lg" />
          ) : (
            "Subir fondo"
          )}
          <input type="file" hidden onChange={handleBackgroundFile} />
        </label>
      </div>

      {/* CHAT */}
      <div className="border rounded-xl bg-black/40">

        <div className="h-[300px] overflow-y-auto p-4 space-y-2">
          {messages.map((m, i) => (
            <MessageBubble key={i} {...m} />
          ))}
        </div>

        <div className="flex gap-2 p-3 border-t">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAskIsabela();
              }
            }}
            className="flex-1 bg-black/60 text-white p-2 rounded"
          />

          <button
            onClick={handleAskIsabela}
            className="bg-purple-500 px-4 rounded text-white"
          >
            Enviar
          </button>
        </div>
      </div>

      {/* GENERAR */}
      <button
        onClick={handleGenerate}
        className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-6 py-3 rounded text-white"
      >
        Generar montaje
      </button>

      {/* RESULTADO */}
      {resultUrl && (
        <img src={resultUrl} className="rounded-xl border" />
      )}

      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
