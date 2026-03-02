// /src/components/AvatarStudioPanel.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

const LS_KEY = "isabelaos_avatarstudio_state_v1";

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function AvatarStudioPanel() {
  const { session } = useAuth();
  const token = session?.access_token || null;

  const fileRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState(""); // texto del paso actual
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  // avatar form
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [avatar, setAvatar] = useState(null);

  // photos
  const [files, setFiles] = useState([]); // seleccionadas (no persistibles)
  const [uploaded, setUploaded] = useState([]); // [{id, storage_path, url?}]
  const [thumbUrl, setThumbUrl] = useState("");

  // training
  const [job, setJob] = useState(null);
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

  // ----------------------------
  // Persistencia (para no perder proceso)
  // ----------------------------
  function persist(next = {}) {
    const payload = {
      name,
      trigger,
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
    if (typeof st.trigger === "string") setTrigger(st.trigger);
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
  }, [name, trigger, avatar, uploaded, thumbUrl, job, polling]);

  const photoCount = uploaded?.length || 0;

  // ----------------------------
  // Refresh helpers
  // ----------------------------
  async function refreshThumbnail(avatarId) {
    try {
      const out = await apiPost("/api/avatars-get-thumbnail-url", { avatar_id: avatarId });
      const url = out?.url || out?.signed_url || out?.signedUrl || "";
      if (url) setThumbUrl(url);
    } catch {
      // si no hay aún, ok
    }
  }

  async function refreshPhotoUrls(avatarId) {
    try {
      const out = await apiPost("/api/avatars-get-photo-urls", { avatar_id: avatarId });
      const items = out?.photos || out?.data || out || [];
      if (Array.isArray(items)) setUploaded(items);
    } catch {
      // opcional
    }
  }

  // Al entrar al panel con un avatar ya creado: refresca
  useEffect(() => {
    if (!canUse) return;
    if (!avatar?.id) return;
    refreshThumbnail(avatar.id);
    refreshPhotoUrls(avatar.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, avatar?.id]);

  // ----------------------------
  // File pick
  // ----------------------------
  function onPickFiles(e) {
    setErr("");
    setInfo("");
    const f = Array.from(e.target.files || []);
    setFiles(f);
  }

  // ----------------------------
  // 1 solo botón: Crear avatar (y subir fotos)
  // ----------------------------
  const canCreate =
    canUse &&
    name.trim().length > 0 &&
    trigger.trim().length > 0 &&
    (avatar?.id ? true : files.length >= 5); // si no existe avatar, pedimos 5+ para crearlo con todo

  async function createAvatarOnly() {
    const out = await apiPost("/api/avatars-create", {
      name: name.trim(),
      trigger: trigger.trim(),
    });

    const created = out.avatar || out.data || out;
    if (!created?.id) throw new Error("AVATAR_CREATE_INVALID_RESPONSE");
    setAvatar(created);
    setUploaded([]);
    setThumbUrl("");
    setJob(null);
    return created;
  }

  async function uploadPhotosForAvatar(avatarId, theFiles) {
    const results = [];
    for (let i = 0; i < theFiles.length; i++) {
      const file = theFiles[i];
      const form = new FormData();
      form.append("avatar_id", avatarId);
      form.append("file", file);
      // importante: marcar la primera como miniatura
      form.append("is_thumbnail", i === 0 ? "true" : "false");

      const r = await fetch("/api/avatars-upload-photo", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "UPLOAD_FAILED");
      results.push(j.photo || j.data || j);
    }
    return results;
  }

  async function onCreateAll() {
    setErr("");
    setInfo("");

    if (!canUse) return setErr("Debes iniciar sesión.");
    if (!name.trim() || !trigger.trim()) return setErr("Falta nombre o trigger.");

    // Si no hay avatar, exigimos 5+
    if (!avatar?.id && files.length < 5) {
      return setErr("Selecciona mínimo 5 fotos para crear el avatar. (La primera será miniatura)");
    }

    setLoading(true);
    try {
      setBusyLabel("Creando avatar...");
      const av = avatar?.id ? avatar : await createAvatarOnly();

      // Si hay fotos seleccionadas, subirlas
      if (files.length > 0) {
        setBusyLabel("Subiendo fotos...");
        await uploadPhotosForAvatar(av.id, files);
        setFiles([]);
      }

      setBusyLabel("Actualizando miniatura...");
      await refreshThumbnail(av.id);

      setBusyLabel("Actualizando lista...");
      await refreshPhotoUrls(av.id);

      setBusyLabel("");
      setInfo("Listo ✅ Avatar creado y fotos guardadas. Esto puede tardar un poco en reflejarse en la miniatura (signed URL).");

      persist(); // asegurar guardado final
    } catch (e) {
      setBusyLabel("");
      setErr(e.message || "ERROR");
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------
  // Entrenamiento
  // ----------------------------
  async function onReadyToTrain() {
    setErr("");
    setInfo("");
    if (!avatar?.id) return setErr("Primero crea un avatar.");
    setLoading(true);
    try {
      await apiPost("/api/avatars-ready-to-train", { avatar_id: avatar.id });
      setInfo("Marcado como listo ✅");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onTrain() {
    setErr("");
    setInfo("");
    if (!avatar?.id) return setErr("Primero crea un avatar.");
    if (photoCount < 5) return setErr("Necesitas mínimo 5 fotos subidas para entrenar.");

    setLoading(true);
    try {
      setBusyLabel("Iniciando entrenamiento en RunPod...");
      const out = await apiPost("/api/avatars-train", { avatar_id: avatar.id });
      setJob(out);
      setPolling(true);
      setBusyLabel("");
      setInfo("Entrenamiento iniciado. Esto puede tardar varios minutos dependiendo de la GPU y la cola.");
    } catch (e) {
      setBusyLabel("");
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Poll runpod
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
          setInfo("Entrenamiento completado ✅");
          await refreshThumbnail(avatar.id);
        }
        if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
          setPolling(false);
          setErr("Entrenamiento falló. Revisa el log del job en RunPod.");
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
  // UI helpers
  // ----------------------------
  const headerStatus = useMemo(() => {
    if (loading && busyLabel) return busyLabel;
    if (polling) return "Entrenando... (puede tardar varios minutos)";
    if (avatar?.id && photoCount >= 5) return "Listo para entrenar ✅";
    if (avatar?.id && photoCount < 5) return `Sube ${Math.max(0, 5 - photoCount)} foto(s) más para entrenar`;
    return "Crea un avatar y sube mínimo 5 fotos";
  }, [loading, busyLabel, polling, avatar?.id, photoCount]);

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
            setTrigger("");
            setAvatar(null);
            setFiles([]);
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

      {/* FORM: nombre + trigger */}
      <div className="mt-4 grid gap-3">
        <div className="grid gap-2 md:grid-cols-[1fr_240px]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del avatar (ej: María v1)"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
            disabled={!canUse || loading || polling}
          />
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="Trigger (ej: mari)"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
            disabled={!canUse || loading || polling}
          />
        </div>

        {/* Avatar info + thumb */}
        {avatar?.id && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs text-neutral-300">
              <span className="text-neutral-400">Avatar:</span>{" "}
              <span className="text-white font-semibold">{avatar.name || name}</span>{" "}
              <span className="text-neutral-500">·</span>{" "}
              <span className="text-neutral-400">ID:</span>{" "}
              <span className="text-neutral-200">{avatar.id}</span>
            </div>

            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt="thumb"
                className="h-12 w-12 rounded-xl border border-white/10 object-cover"
              />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/5 text-xs text-neutral-500">
                —
              </div>
            )}
          </div>
        )}

        {/* FILE PICKER */}
        <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-white">Fotos de entrenamiento</div>
              <div className="text-xs text-neutral-400">
                Mínimo 5. La primera se usa como miniatura (thumbnail).
              </div>
            </div>
            <div className="text-xs text-neutral-300">
              Subidas: <span className="text-white font-semibold">{photoCount}</span>
            </div>
          </div>

          <div className="mt-3 flex gap-2 flex-wrap items-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onPickFiles}
              style={{ display: "none" }}
              disabled={!canUse || loading || polling}
            />

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!canUse || loading || polling}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50"
            >
              Elegir fotos
            </button>

            <div className="text-xs text-neutral-400">
              Seleccionadas: <span className="text-neutral-200 font-semibold">{files.length}</span>
              {files.length > 0 ? (
                <span className="ml-2 text-neutral-500">(No se suben hasta “Crear avatar”)</span>
              ) : null}
            </div>
          </div>

          {/* PREVIEW de lo ya subido */}
          {Array.isArray(uploaded) && uploaded.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {uploaded.map((p, idx) => {
                const url = p.url || p.signed_url || p.signedUrl || "";
                return (
                  <div key={p.id || p.storage_path || idx} className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                    {url ? (
                      <img src={url} alt="photo" className="h-24 w-full object-cover" />
                    ) : (
                      <div className="grid h-24 place-items-center text-xs text-neutral-500">Sin URL</div>
                    )}
                    <div className="p-2 text-[10px] text-neutral-400">
                      <div className="truncate">
                        {p.storage_path ? p.storage_path.split("/").slice(-2).join("/") : "photo"}
                      </div>
                      {idx === 0 && <div className="mt-1 text-[10px] text-cyan-200 font-semibold">miniatura</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* BOTÓN ÚNICO */}
        <button
          type="button"
          disabled={!canCreate || loading || polling}
          onClick={onCreateAll}
          className={`rounded-2xl px-4 py-3 text-sm font-semibold text-white ${
            canCreate
              ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:opacity-95"
              : "bg-white/10 opacity-60"
          }`}
        >
          {loading ? (busyLabel ? busyLabel : "Procesando...") : "Crear avatar"}
        </button>

        {/* Entrenamiento (dejamos limpio) */}
        {avatar?.id && (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-white">Entrenamiento LoRA (RunPod)</div>
                <div className="text-xs text-neutral-400">
                  Cuando tengas 5+ fotos, puedes iniciar el entrenamiento. Puede tardar varios minutos.
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={loading || polling}
                  onClick={onReadyToTrain}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50"
                >
                  Marcar listo
                </button>

                <button
                  type="button"
                  disabled={loading || polling || photoCount < 5}
                  onClick={onTrain}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
                    photoCount < 5 ? "bg-white/10" : "bg-gradient-to-r from-cyan-500 to-fuchsia-500"
                  }`}
                >
                  {polling ? "Entrenando..." : "Entrenar"}
                </button>
              </div>
            </div>

            {job && (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/50 p-3 text-xs text-neutral-200 whitespace-pre-wrap">
                {JSON.stringify(job, null, 2)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
