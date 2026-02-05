import React, { useMemo, useRef, useState } from "react";

export default function VoiceToVideoPanel({ userStatus }) {
  const [seconds, setSeconds] = useState(3); // 3 or 5
  const [voice, setVoice] = useState("female"); // female|male
  const [lang, setLang] = useState("es"); // es|en
  const [text, setText] = useState("");
  const [videoFile, setVideoFile] = useState(null);

  const [status, setStatus] = useState("IDLE");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState(null);

  const fileInputRef = useRef(null);

  const maxChars = seconds === 3 ? 45 : 80;

  const counterColor = useMemo(() => {
    if (text.length <= 45) return "#2da8ff";     // azul (3s)
    if (text.length <= 80) return "#a855f7";     // morado (5s)
    return "#ff3b3b";                            // rojo
  }, [text]);

  const handlePickVideo = () => fileInputRef.current?.click();

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file); // data:video/mp4;base64,...
    });

  const onChangeText = (v) => {
    // bloqueo duro: no más que 80 nunca
    if (v.length > 80) return;
    setText(v);
  };

  const canRun = !!videoFile && text.trim().length > 0;

  async function submit() {
    setError("");
    setStatus("RUNNING");
    setStatusText("Subiendo video y generando voz...");

    try {
      const dataUrl = await fileToBase64(videoFile);

      // recorte por segundos
      const safe = text.slice(0, maxChars);

      const r = await fetch("/api/generate-voice2video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seconds,
          voice,
          lang,
          text: safe,
          video_b64: dataUrl,
        }),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || "Error generando voice-to-video");
      }

      setJobId(data.job_id);
      setStatus("DONE");
      setStatusText("Job enviado. Revisa tu sección de estado / librería.");
    } catch (e) {
      setStatus("ERROR");
      setStatusText("");
      setError(e?.message || "Error");
    }
  }

  return (
    <div style={{ border: "1px solid #2a2a2a", borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Voz a Video (Beta)</div>
          <div style={{ opacity: 0.8, marginTop: 4 }}>LipSync + voz realista (XTTS + MuseTalk)</div>
        </div>
        <div style={{ fontWeight: 700 }}>Costo: 12 jades</div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Duración:
          <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
            <option value={3}>3 segundos</option>
            <option value={5}>5 segundos</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Voz:
          <select value={voice} onChange={(e) => setVoice(e.target.value)}>
            <option value="female">Mujer</option>
            <option value="male">Hombre</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Idioma:
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontWeight: 700 }}>Texto</div>
          <div style={{ fontWeight: 700, color: counterColor }}>
            {text.length}/{maxChars} ({seconds === 3 ? "3s" : "5s"})
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={
            seconds === 3
              ? "Máx 45 caracteres (3s). Ej: “Hola, fui creada por IsabelaOS Studio.”"
              : "Máx 80 caracteres (5s). Ej: “Hola, fui creada por IsabelaOS Studio. ¿Listo para ver magia?”"
          }
          style={{
            width: "100%",
            minHeight: 90,
            marginTop: 8,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #2a2a2a",
            outline: "none",
            resize: "vertical",
          }}
        />

        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>
          <span style={{ color: "#2da8ff", fontWeight: 700 }}>0–45</span> (3s) ·{" "}
          <span style={{ color: "#a855f7", fontWeight: 700 }}>46–80</span> (5s) ·{" "}
          <span style={{ color: "#ff3b3b", fontWeight: 700 }}>>80</span> no permitido
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700 }}>Video</div>

        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          style={{ display: "none" }}
          onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
        />

        <button
          type="button"
          onClick={handlePickVideo}
          style={{
            marginTop: 8,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #2a2a2a",
            cursor: "pointer",
          }}
        >
          {videoFile ? `Video seleccionado: ${videoFile.name}` : "Subir video (rostro)"}
        </button>

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9, lineHeight: 1.35 }}>
          <b>Requisitos del video</b>
          <br />
          ✅ Solo rostro visible (ideal: primer plano / medio cuerpo con cara grande) <br />
          ✅ Una sola persona <br />
          ❌ Cuerpo completo o cara muy pequeña puede fallar <br />
          Recomendado: 720p/1080p, 24–30 fps, 3–5s
        </div>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          disabled={!canRun || status === "RUNNING"}
          onClick={submit}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #2a2a2a",
            cursor: canRun ? "pointer" : "not-allowed",
            opacity: canRun ? 1 : 0.6,
            fontWeight: 800,
          }}
        >
          Generar video con voz
        </button>

        {status !== "IDLE" && (
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            <b>{status}</b> {statusText ? `— ${statusText}` : ""}
            {jobId ? <div>Job: <b>{jobId}</b></div> : null}
          </div>
        )}
      </div>

      {error ? (
        <div style={{ marginTop: 10, color: "#ff3b3b", fontWeight: 700 }}>{error}</div>
      ) : null}
    </div>
  );
}
