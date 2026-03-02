// /src/components/AvatarStudioPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function AvatarStudioPanel() {
  const { session } = useAuth();
  const token = session?.access_token || null;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // avatar form
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [avatar, setAvatar] = useState(null);

  // photos
  const [files, setFiles] = useState([]);
  const [uploaded, setUploaded] = useState([]); // [{id, storage_path, url?}]
  const [thumbUrl, setThumbUrl] = useState("");

  // training
  const [job, setJob] = useState(null); // job row or status
  const [polling, setPolling] = useState(false);

  const canUse = !!token;

  const authHeaders = useMemo(() => {
    const h = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  async function apiPost(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || "API_ERROR");
    return j;
  }

  async function apiGet(path) {
    const r = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || "API_ERROR");
    return j;
  }

  // 1) Crear avatar
  async function onCreateAvatar() {
    setErr("");
    if (!canUse) return setErr("Debes iniciar sesión.");
    if (!name.trim() || !trigger.trim()) return setErr("Falta nombre o trigger.");

    setLoading(true);
    try {
      const out = await apiPost("/api/avatars-create", {
        name: name.trim(),
        trigger: trigger.trim(),
      });

      // Tu endpoint puede devolver {avatar} o {data}. Ajusto a ambos:
      const created = out.avatar || out.data || out;
      setAvatar(created);
      setUploaded([]);
      setThumbUrl("");
      setJob(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  // 2) Seleccionar fotos
  function onPickFiles(e) {
    setErr("");
    const f = Array.from(e.target.files || []);
    setFiles(f);
  }

  // 3) Subir una por una (usa tu /api/avatars-upload-photo.js)
  async function onUploadPhotos() {
    setErr("");
    if (!avatar?.id) return setErr("Primero crea un avatar.");
    if (!files.length) return setErr("Selecciona fotos.");

    setLoading(true);
    try {
      const results = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // enviamos multipart/form-data
        const form = new FormData();
        form.append("avatar_id", avatar.id);
        form.append("file", file);

        const r = await fetch("/api/avatars-upload-photo", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || "UPLOAD_FAILED");

        // esperamos algo tipo {photo} o {data}
        results.push(j.photo || j.data || j);
      }

      setUploaded((prev) => [...prev, ...results]);
      setFiles([]);

      // refrescar miniatura (signed url) si ya existe
      await refreshThumbnail(avatar.id);
      // refrescar lista de fotos (si tu endpoint lo permite)
      await refreshPhotoUrls(avatar.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  // 4) Traer signed url miniatura
  async function refreshThumbnail(avatarId) {
    try {
      const out = await apiPost("/api/avatars-get-thumbnail-url", { avatar_id: avatarId });
      const url = out?.url || out?.signed_url || out?.signedUrl || "";
      if (url) setThumbUrl(url);
    } catch {
      // no pasa nada si aún no hay thumbnail
    }
  }

  // 5) Traer signed urls de fotos (para previsualizar)
  async function refreshPhotoUrls(avatarId) {
    try {
      const out = await apiPost("/api/avatars-get-photo-urls", { avatar_id: avatarId });
      const items = out?.photos || out?.data || out || [];
      // items puede venir como [{storage_path, url}] según tu endpoint
      if (Array.isArray(items)) setUploaded(items);
    } catch {
      // opcional
    }
  }

  // 6) Marcar listo para entrenar (opcional, depende de tu backend)
  async function onReadyToTrain() {
    setErr("");
    if (!avatar?.id) return setErr("Primero crea un avatar.");
    setLoading(true);
    try {
      await apiPost("/api/avatars-ready-to-train", { avatar_id: avatar.id });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  // 7) Disparar training
  async function onTrain() {
    setErr("");
    if (!avatar?.id) return setErr("Primero crea un avatar.");

    setLoading(true);
    try {
      const out = await apiPost("/api/avatars-train", { avatar_id: avatar.id });
      // out puede devolver job_db_id + runpod_job_id
      setJob(out);
      setPolling(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  // 8) Poll runpod
  useEffect(() => {
    let t = null;
    async function tick() {
      if (!polling) return;
      if (!avatar?.id) return;

      try {
        const out = await apiPost("/api/avatars-poll-runpod", { avatar_id: avatar.id });
        setJob(out);

        const status = (out?.status || out?.job_status || "").toString().toUpperCase();
        if (["SUCCEEDED", "COMPLETED", "DONE"].includes(status)) {
          setPolling(false);
          // refrescar thumb / lora url si ya lo guardas
          await refreshThumbnail(avatar.id);
        }
        if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
          setPolling(false);
        }
      } catch (e) {
        setErr(e.message);
        setPolling(false);
      }
    }

    if (polling) {
      tick();
      t = setInterval(tick, 4000);
    }
    return () => t && clearInterval(t);
  }, [polling, avatar?.id]); // eslint-disable-line

  const photoCount = uploaded?.length || 0;

  return (
    <div style={{ padding: 16, border: "1px solid #333", borderRadius: 12 }}>
      <h2 style={{ margin: 0, marginBottom: 10 }}>Avatar Studio</h2>

      {!canUse && (
        <div style={{ padding: 10, background: "#2a1a1a", borderRadius: 10, marginBottom: 12 }}>
          Inicia sesión para crear y entrenar avatares.
        </div>
      )}

      {err && (
        <div style={{ padding: 10, background: "#2a1a1a", borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      )}

      {/* Crear avatar */}
      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del avatar (ej: Isabela v2)"
            style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 10, border: "1px solid #444", background: "#111", color: "#fff" }}
          />
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="Trigger (ej: isaNoir)"
            style={{ width: 180, padding: 10, borderRadius: 10, border: "1px solid #444", background: "#111", color: "#fff" }}
          />
          <button
            disabled={loading || !canUse}
            onClick={onCreateAvatar}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #444", background: "#1b1b1b", color: "#fff", cursor: "pointer" }}
          >
            {loading ? "..." : "Crear avatar"}
          </button>
        </div>

        {avatar?.id && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, opacity: 0.9 }}>
              <b>Avatar:</b> {avatar.name || name} — <b>ID:</b> {avatar.id}
            </div>

            {thumbUrl ? (
              <img src={thumbUrl} alt="thumb" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", border: "1px solid #333" }} />
            ) : (
              <div style={{ width: 52, height: 52, borderRadius: 10, border: "1px solid #333", display: "grid", placeItems: "center", opacity: 0.6 }}>
                —
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subir fotos */}
      <div style={{ padding: 12, border: "1px solid #333", borderRadius: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <b>Fotos de entrenamiento</b>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Sube mínimo 5. La primera será miniatura.</div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Subidas: <b>{photoCount}</b></div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            disabled={!avatar?.id || loading}
            style={{ padding: 6 }}
          />
          <button
            disabled={!avatar?.id || loading || !files.length}
            onClick={onUploadPhotos}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #444", background: "#1b1b1b", color: "#fff", cursor: "pointer" }}
          >
            {loading ? "Subiendo..." : `Subir ${files.length || 0} foto(s)`}
          </button>

          <button
            disabled={!avatar?.id || loading}
            onClick={() => refreshPhotoUrls(avatar.id)}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #444", background: "#111", color: "#fff", cursor: "pointer" }}
          >
            Refrescar
          </button>
        </div>

        {/* Preview grid */}
        {Array.isArray(uploaded) && uploaded.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10, marginTop: 12 }}>
            {uploaded.map((p, idx) => {
              const url = p.url || p.signed_url || p.signedUrl || "";
              return (
                <div key={p.id || p.storage_path || idx} style={{ border: "1px solid #333", borderRadius: 12, overflow: "hidden" }}>
                  {url ? (
                    <img src={url} alt="photo" style={{ width: "100%", height: 110, objectFit: "cover" }} />
                  ) : (
                    <div style={{ height: 110, display: "grid", placeItems: "center", opacity: 0.6 }}>Sin URL</div>
                  )}
                  <div style={{ padding: 8, fontSize: 11, opacity: 0.8, wordBreak: "break-word" }}>
                    {p.storage_path ? p.storage_path.split("/").slice(-2).join("/") : "photo"}
                    {idx === 0 && <div style={{ marginTop: 4 }}><b>miniatura</b></div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Entrenamiento */}
      <div style={{ padding: 12, border: "1px solid #333", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <b>Entrenamiento LoRA (RunPod)</b>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Cuando haya 5+ fotos, puedes entrenar.</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              disabled={!avatar?.id || loading}
              onClick={onReadyToTrain}
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #444", background: "#111", color: "#fff", cursor: "pointer" }}
            >
              Marcar listo
            </button>
            <button
              disabled={!avatar?.id || loading || photoCount < 5}
              onClick={onTrain}
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #444", background: photoCount < 5 ? "#111" : "#1b1b1b", color: "#fff", cursor: "pointer" }}
            >
              {polling ? "Entrenando..." : "Entrenar"}
            </button>
          </div>
        </div>

        {job && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(job, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}
