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

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function AvatarStudioPanel() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const userId = session?.user?.id || ""; // ✅ IMPORTANTÍSIMO para tus endpoints

  const fileRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  // avatar form
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [avatar, setAvatar] = useState(null);

  // fotos
  const [files, setFiles] = useState([]); // pendientes (1x1)
  const [uploaded, setUploaded] = useState([]); // [{id, storage_path, url, created_at, ...}]
  const [thumbUrl, setThumbUrl] = useState("");

  // training
  const [job, setJob] = useState(null);
  const [polling, setPolling] = useState(false);

  const canUse = !!token && !!userId;

  const authJsonHeaders = useMemo(() => {
    const h = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  async function apiPost(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: authJsonHeaders,
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || "API_ERROR");
    return j;
  }

  async function apiGet(path) {
    const r = await fetch(path, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || "API_ERROR");
    return j;
  }

  // ----------------------------
  // Persistencia (no perder proceso)
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
      // files NO (File objects no se deben persistir)
      ...next,
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}
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
    } catch {}
  }

  useEffect(() => {
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, trigger, avatar, uploaded, thumbUrl, job, polling]);

  const uploadedCount = uploaded?.length || 0;
  const pendingCount = files?.length || 0;
  const totalCount = uploadedCount + pendingCount;

  // ----------------------------
  // Refresh helpers (AJUSTADOS A TUS ENDPOINTS)
  // ----------------------------

  // ✅ OJO:
  // - Tu avatars-get-photo-urls que pegaste es GET y requiere user_id y avatar_id en query.
  async function refreshPhotoUrls(avatarId) {
    try {
      const out = await apiGet(
        `/api/avatars-get-photo-urls?avatar_id=${encodeURIComponent(avatarId)}&user_id=${encodeURIComponent(
          userId
        )}`
      );
      const items = out?.photos || [];
      if (Array.isArray(items)) setUploaded(items);
    } catch {
      // ok
    }
  }

  // ✅ thumbnail: si tu endpoint es GET, deja esto así.
  // Si tu endpoint es POST, cambia esta función a apiPost("/api/avatars-get-thumbnail-url", { avatar_id, user_id })
  async function refreshThumbnail(avatarId) {
    try {
      const out = await apiGet(
        `/api/avatars-get-thumbnail-url?avatar_id=${encodeURIComponent(avatarId)}&user_id=${encodeURIComponent(userId)}`
      );
      const url = out?.url || out?.signedUrl || out?.signed_url || "";
      if (url) setThumbUrl(url);
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
  // File pick (1 por 1)
  // ----------------------------
  function onPickOneFile(e) {
    setErr("");
    setInfo("");

    const f = e.target.files?.[0];
    if (!f) return;

    setFiles((prev) => [...prev, f]);

    // reset input para poder elegir el mismo archivo de nuevo si quisieras
    e.target.value = "";
  }

  function removePending(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function clearPending() {
    setFiles([]);
  }

  // ----------------------------
  // Crear avatar / subir fotos
  // ----------------------------
  const needsMinPhotosToCreate = !avatar?.id;
  const canCreate =
    canUse &&
    name.trim().length > 0 &&
    trigger.trim().length > 0 &&
    (needsMinPhotosToCreate ? totalCount >= 5 : true);

  async function createAvatarOnly() {
    // ✅ Tu backend te estaba dando 400 por falta de user_id
    const out = await apiPost("/api/avatars-create", {
      user_id: userId,
      name: name.trim(),
      trigger: trigger.trim(),
    });

    const created = out.avatar || out.data || out;
    if (!created?.id) throw new Error("AVATAR_CREATE_INVALID_RESPONSE");

    setAvatar(created);
    setJob(null);
    return created;
  }

  // ✅ IMPORTANTE: tu upload handler que pegaste exige:
  // { user_id, avatar_id, image_b64, filename }
  async function uploadPhotosForAvatar(avatarId, theFiles) {
    for (let i = 0; i < theFiles.length; i++) {
      const file = theFiles[i];
      const dataUrl = await fileToDataURL(file);

      await apiPost("/api/avatars-upload-photo", {
        user_id: userId,
        avatar_id: avatarId,
        image_b64: dataUrl,
        filename: file.name,
      });
    }
  }

  async function onCreateAll() {
    setErr("");
    setInfo("");

    if (!canUse) return setErr("Debes iniciar sesión.");
    if (!name.trim() || !trigger.trim()) return setErr("Falta nombre o trigger.");

    if (!avatar?.id && totalCount < 5) {
      return setErr("Agrega mínimo 5 fotos (una por una). La primera que SUBAS será la miniatura.");
    }

    setLoading(true);
    try {
      // 1) crear avatar si no existe
      setBusyLabel(avatar?.id ? "Guardando..." : "Creando avatar...");
      const av = avatar?.id ? avatar : await createAvatarOnly();

      // 2) subir pendientes si hay
      if (files.length > 0) {
        setBusyLabel("Subiendo fotos... (esto puede tardar)");
        const toUpload = [...files]; // snapshot
        setFiles([]); // limpia rápido UI (evita doble click)
        await uploadPhotosForAvatar(av.id, toUpload);
      }

      // 3) refrescar UI
      setBusyLabel("Actualizando miniatura...");
      await refreshThumbnail(av.id);

      setBusyLabel("Actualizando lista...");
      await refreshPhotoUrls(av.id);

      setBusyLabel("");
      setInfo(
        "Listo ✅ Guardado. Nota: la miniatura/signed URLs a veces tardan unos segundos en verse (normal)."
      );
      persist();
    } catch (e) {
      setBusyLabel("");
      setErr(e?.message || "ERROR");
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
      await apiPost("/api/avatars-ready-to-train", { user_id: userId, avatar_id: avatar.id });
      setInfo("Marcado como listo ✅");
    } catch (e) {
      setErr(e?.message || "ERROR");
    } finally {
      setLoading(false);
    }
  }

  async function onTrain() {
    setErr("");
    setInfo("");
    if (!avatar?.id) return setErr("Primero crea un avatar.");
    if (uploadedCount < 5) return setErr("Necesitas mínimo 5 fotos SUBIDAS para entrenar.");

    setLoading(true);
    try {
      setBusyLabel("Iniciando entrenamiento en RunPod... (puede tardar)");
      const out = await apiPost("/api/avatars-train", { user_id: userId, avatar_id: avatar.id });
      setJob(out);
      setPolling(true);
      setBusyLabel("");
      setInfo("Entrenamiento iniciado. Puede tardar varios minutos dependiendo de la GPU/cola.");
    } catch (e) {
      setBusyLabel("");
      setErr(e?.message || "ERROR");
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
        const out = await apiPost("/api/avatars-poll-runpod", { user_id: userId, avatar_id: avatar.id });
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
        setErr(e?.message || "ERROR");
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
  // UI state
  // ----------------------------
  const headerStatus = useMemo(() => {
    if (loading && busyLabel) return busyLabel;
    if (polling) return "Entrenando... (puede tardar varios minutos)";
    if (avatar?.id && uploadedCount >= 5) return "Listo para entrenar ✅";
    if (avatar?.id && uploadedCount < 5) return `Sube ${Math.max(0, 5 - uploadedCount)} foto(s) más (SUBIDAS) para entrenar`;
    return "Crea un avatar y sube mínimo 5 fotos";
  }, [loading, busyLabel, polling, avatar?.id, uploadedCount]);

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

      {/* FORM */}
      <div className="mt-4 grid gap-3">
        <div className="grid gap-2 md:grid-cols-[1fr_240px]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del avatar (ej: Isabela Noir v1)"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
            disabled={!canUse || loading || polling}
          />
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="Trigger (ej: isanoir)"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
            disabled={!canUse || loading || polling}
          />
        </div>

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
              <img src={thumbUrl} alt="thumb" className="h-12 w-12 rounded-xl border border-white/10 object-cover" />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/5 text-xs text-neutral-500">
                —
              </div>
            )}
          </div>
        )}

        {/* Fotos */}
        <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-white">Fotos de entrenamiento</div>
              <div className="text-xs text-neutral-400">
                Agrega 5 fotos (una por una). La primera foto SUBIDA se usa como miniatura.
              </div>
            </div>
            <div className="text-xs text-neutral-300">
              Subidas: <span className="text-white font-semibold">{uploadedCount}</span>
              <span className="text-neutral-500"> · </span>
              Pendientes: <span className="text-white font-semibold">{pendingCount}</span>
            </div>
          </div>

          <div className="mt-3 flex gap-2 flex-wrap items-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple={false} // ✅ 1 por 1
              onChange={onPickOneFile}
              style={{ display: "none" }}
              disabled={!canUse || loading || polling}
            />

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!canUse || loading || polling}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50"
            >
              Agregar 1 foto
            </button>

            <div className="text-xs text-neutral-400">
              Total (subidas + pendientes):{" "}
              <span className="text-neutral-200 font-semibold">{totalCount}</span>
              {needsMinPhotosToCreate ? (
                <span className="ml-2 text-neutral-500">
                  (mínimo 5 para crear)
                </span>
              ) : (
                <span className="ml-2 text-neutral-500">
                  (se suben cuando presionas “Guardar cambios”)
                </span>
              )}
            </div>

            {pendingCount > 0 && (
              <button
                type="button"
                onClick={clearPending}
                disabled={loading || polling}
                className="ml-auto rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50"
              >
                Limpiar pendientes
              </button>
            )}
          </div>

          {/* Pendientes */}
          {pendingCount > 0 && (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="text-xs font-semibold text-neutral-200 mb-2">Pendientes por subir</div>
              <div className="space-y-2">
                {files.map((f, idx) => (
                  <div key={`${f.name}-${idx}`} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-200 truncate">
                        {idx === 0 && uploadedCount === 0 ? "⭐ (será miniatura) " : ""}
                        {f.name}
                      </div>
                      <div className="text-[11px] text-neutral-500">{Math.round((f.size || 0) / 1024)} KB</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePending(idx)}
                      disabled={loading || polling}
                      className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-neutral-200 hover:bg-white/10 disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subidas */}
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
            canCreate ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:opacity-95" : "bg-white/10 opacity-60"
          }`}
        >
          {loading
            ? busyLabel || "Procesando..."
            : avatar?.id
            ? "Guardar cambios"
            : "Crear avatar"}
        </button>

        {/* Entrenamiento */}
        {avatar?.id && (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-white">Entrenamiento LoRA (RunPod)</div>
                <div className="text-xs text-neutral-400">
                  Cuando tengas 5+ fotos SUBIDAS, puedes entrenar. Puede tardar varios minutos.
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
                  disabled={loading || polling || uploadedCount < 5}
                  onClick={onTrain}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
                    uploadedCount < 5 ? "bg-white/10" : "bg-gradient-to-r from-cyan-500 to-fuchsia-500"
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
