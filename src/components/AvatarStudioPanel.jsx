// /src/components/AvatarStudioPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

const LS_KEY = "isabelaos_avatarstudio_state_v2";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function bytesLabel(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeStatus(job) {
  const raw = (job?.status || job?.job_status || job?.state || "").toString().toUpperCase();
  if (!raw) return "—";
  if (["IN_QUEUE", "QUEUED", "QUEUE", "PENDING"].includes(raw)) return "IN_QUEUE";
  if (["IN_PROGRESS", "RUNNING", "PROCESSING", "STARTED"].includes(raw)) return "IN_PROGRESS";
  if (["SUCCEEDED", "COMPLETED", "DONE", "SUCCESS"].includes(raw)) return "SUCCEEDED";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(raw)) return "FAILED";
  return raw;
}

export default function AvatarStudioPanel() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const userId = session?.user?.id || null;

  // input escondido para elegir 1 foto
  const fileRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  // avatar
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(null); // {id, name, trigger, ...}
  const [thumbUrl, setThumbUrl] = useState("");

  // fotos
  const [pending, setPending] = useState([]); // File[] (NO persist)
  const [uploaded, setUploaded] = useState([]); // [{id, storage_path, url, created_at}]

  // training
  const [job, setJob] = useState(null);
  const [polling, setPolling] = useState(false);

  const canUse = !!token && !!userId;

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

  async function apiGetJson(path) {
    const r = await fetch(path, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || "API_ERROR");
    return j;
  }

  // ----------------------------
  // Persistencia (NO guarda files, solo avatar + urls + job)
  // ----------------------------
  function persist(next = {}) {
    const payload = {
      name,
      avatar,
      uploaded,
      thumbUrl,
      job,
      polling,
      ...next,
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function restore() {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return;
    const st = safeParse(raw);
    if (!st) return;

    if (typeof st.name === "string") setName(st.name);
    if (st.avatar && typeof st.avatar === "object") setAvatar(st.avatar);
    if (Array.isArray(st.uploaded)) setUploaded(st.uploaded);
    if (typeof st.thumbUrl === "string") setThumbUrl(st.thumbUrl);
    if (st.job) setJob(st.job);
    if (typeof st.polling === "boolean") setPolling(st.polling);
  }

  function clearPersisted() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, avatar, uploaded, thumbUrl, job, polling]);

  const uploadedCount = uploaded?.length || 0;
  const pendingCount = pending?.length || 0;
  const totalCount = uploadedCount + pendingCount;

  // ----------------------------
  // Refresh helpers (tus endpoints son GET con query)
  // ----------------------------
  async function refreshThumbnail(avatarId) {
    if (!avatarId || !userId) return;
    try {
      const out = await apiGetJson(
        `/api/avatars-get-thumbnail-url?avatar_id=${encodeURIComponent(avatarId)}&user_id=${encodeURIComponent(userId)}`
      );
      const url = out?.thumb_url || out?.url || out?.signed_url || out?.signedUrl || "";
      if (url) setThumbUrl(url);
    } catch {
      // ok
    }
  }

  async function refreshPhotoUrls(avatarId) {
    if (!avatarId || !userId) return;
    try {
      const out = await apiGetJson(
        `/api/avatars-get-photo-urls?avatar_id=${encodeURIComponent(avatarId)}&user_id=${encodeURIComponent(userId)}`
      );
      const items = out?.photos || out?.data || out || [];
      if (Array.isArray(items)) setUploaded(items);
    } catch {
      // ok
    }
  }

  useEffect(() => {
    if (!canUse) return;
    if (!avatar?.id) return;
    refreshThumbnail(avatar.id);
    refreshPhotoUrls(avatar.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, avatar?.id]);

  // ----------------------------
  // Pick 1 file (sin multiple)
  // ----------------------------
  function onPickOne(e) {
    setErr("");
    setInfo("");
    const f = e.target.files?.[0];
    if (!f) return;

    // reset input para poder elegir la misma foto otra vez si quieren
    e.target.value = "";

    setPending((prev) => [...prev, f]);
  }

  function removePending(idx) {
    setPending((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearPending() {
    setPending([]);
  }

  // ----------------------------
  // Crear avatar (backend pide user_id + name) y subir fotos (JSON base64)
  // ----------------------------
  async function createAvatarOnly() {
    const out = await apiPost("/api/avatars-create", {
      user_id: userId,
      name: name.trim(),
    });

    const created = out.avatar || out.data || out;
    if (!created?.id) throw new Error("AVATAR_CREATE_INVALID_RESPONSE");

    setAvatar(created);
    setUploaded([]);
    setThumbUrl("");
    setJob(null);
    return created;
  }

  async function uploadPendingForAvatar(avatarId, filesArr) {
    const results = [];
    for (let i = 0; i < filesArr.length; i++) {
      const file = filesArr[i];
      const dataUrl = await fileToDataURL(file);

      const out = await apiPost("/api/avatars-upload-photo", {
        user_id: userId,
        avatar_id: avatarId,
        image_b64: dataUrl,
        filename: file.name,
      });

      results.push(out.photo || out.data || out);
    }
    return results;
  }

  const canCreateOrSave =
    canUse &&
    name.trim().length > 0 &&
    (
      avatar?.id
        ? true // si ya existe avatar, puedes guardar cambios aunque sean 0 (pero no hace nada)
        : pendingCount >= 5 // si no existe, pedimos 5 fotos pendientes
    );

  async function onCreateOrSave() {
    setErr("");
    setInfo("");

    if (!canUse) return setErr("Debes iniciar sesión.");
    if (!name.trim()) return setErr("Falta nombre del avatar.");

    if (!avatar?.id && pendingCount < 5) {
      return setErr("Agrega mínimo 5 fotos (una por una). La primera foto subida se usa como miniatura.");
    }

    setLoading(true);
    try {
      // 1) Crear avatar si no existe
      setBusyLabel(avatar?.id ? "Preparando..." : "Creando avatar...");
      const av = avatar?.id ? avatar : await createAvatarOnly();

      // 2) Subir pendientes
      if (pendingCount > 0) {
        setBusyLabel(`Subiendo ${pendingCount} foto(s)... (puede tardar)`);
        await uploadPendingForAvatar(av.id, pending);
        setPending([]);
      }

      // 3) Refrescar listas
      setBusyLabel("Actualizando miniatura...");
      await refreshThumbnail(av.id);

      setBusyLabel("Actualizando lista...");
      await refreshPhotoUrls(av.id);

      setBusyLabel("");
      setInfo(
        "Listo ✅ Guardado. Si la miniatura tarda en verse, es normal: los signed URLs a veces tardan unos segundos."
      );
      persist();
    } catch (e) {
      setBusyLabel("");
      setErr(e.message || "ERROR");
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------
  // Entrenamiento: UI limpia (solo estado)
  // ----------------------------
  async function onTrain() {
    setErr("");
    setInfo("");
    if (!avatar?.id) return setErr("Primero crea el avatar.");
    if (uploadedCount < 5) return setErr("Necesitas mínimo 5 fotos SUBIDAS para entrenar.");

    setLoading(true);
    try {
      setBusyLabel("Enviando a RunPod... (puede tardar)");
      const out = await apiPost("/api/avatars-train", { avatar_id: avatar.id });
      setJob(out);
      setPolling(true);
      setBusyLabel("");
      setInfo("Entrenamiento iniciado. Puede tardar varios minutos.");
    } catch (e) {
      setBusyLabel("");
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let t = null;

    async function tick() {
      if (!polling) return;
      if (!avatar?.id) return;

      try {
        const out = await apiPost("/api/avatars-poll-runpod", { avatar_id: avatar.id });
        setJob(out);

        const st = normalizeStatus(out);
        if (st === "SUCCEEDED") {
          setPolling(false);
          setInfo("Entrenamiento completado ✅");
          await refreshThumbnail(avatar.id);
        }
        if (st === "FAILED") {
          setPolling(false);
          setErr(out?.error || "Entrenamiento falló. Revisa el log del job en RunPod.");
        }
      } catch (e) {
        setErr(e.message);
        setPolling(false);
      }
    }

    if (polling) {
      tick();
      t = setInterval(tick, 4500);
    }
    return () => t && clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, avatar?.id]);

  // ----------------------------
  // Header status
  // ----------------------------
  const headerStatus = useMemo(() => {
    if (loading && busyLabel) return busyLabel;
    if (polling) return "IN_PROGRESS (entrenando, puede tardar varios minutos)";
    if (!avatar?.id) {
      if (pendingCount >= 5) return "Listo para crear ✅";
      return `Agrega mínimo 5 fotos (pendientes: ${pendingCount}/5)`;
    }
    if (uploadedCount >= 5) return "Listo para entrenar ✅";
    return `Sube ${Math.max(0, 5 - uploadedCount)} foto(s) más para entrenar`;
  }, [loading, busyLabel, polling, avatar?.id, pendingCount, uploadedCount]);

  const runStatus = useMemo(() => {
    const st = normalizeStatus(job);
    if (st === "—") return null;
    return st;
  }, [job]);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Avatar Studio</h2>
          <p className="text-xs text-neutral-400 mt-1">
            Crea un avatar y entrena un LoRA facial. <span className="text-neutral-300">Esto puede tardar varios minutos.</span>
          </p>
          <div className="mt-2 text-[11px] text-neutral-300">
            Estado: <span className="text-white">{headerStatus}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setName("");
            setAvatar(null);
            setPending([]);
            setUploaded([]);
            setThumbUrl("");
            setJob(null);
            setPolling(false);
            setErr("");
            setInfo("");
            clearPersisted();
          }}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10"
        >
          Reiniciar
        </button>
      </div>

      {!canUse && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
          Inicia sesión para crear y entrenar avatares.
        </div>
      )}

      {err && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
          {err}
        </div>
      )}

      {info && (
        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
          {info}
        </div>
      )}

      {/* FORM */}
      <div className="mt-4 grid gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del avatar (ej: Isabela v1)"
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
          disabled={!canUse || loading || polling}
        />

        {/* Avatar info + trigger + thumb */}
        {avatar?.id && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs text-neutral-300">
              <span className="text-neutral-400">Avatar:</span>{" "}
              <span className="text-white font-semibold">{avatar.name || name}</span>{" "}
              <span className="text-neutral-500">·</span>{" "}
              <span className="text-neutral-400">Trigger:</span>{" "}
              <span className="text-neutral-200 font-semibold">{avatar.trigger || "—"}</span>
            </div>

            {thumbUrl ? (
              <img src={thumbUrl} alt="thumb" className="h-12 w-12 rounded-xl border border-white/10 object-cover" />
            ) : (
              <div className="grid h-12 w-12
