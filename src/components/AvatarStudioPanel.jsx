import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

const LS_KEY = "isabelaos_avatarstudio_state_v3";

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

function normalizeStatus(jobLike) {
  const raw = (
    jobLike?.status ||
    jobLike?.job_status ||
    jobLike?.state ||
    jobLike?.jobStatus ||
    ""
  )
    .toString()
    .toUpperCase();

  if (!raw) return "—";
  if (["IN_QUEUE", "QUEUED", "QUEUE", "PENDING"].includes(raw)) return "IN_QUEUE";
  if (["IN_PROGRESS", "RUNNING", "PROCESSING", "STARTED", "TRAINING"].includes(raw)) return "IN_PROGRESS";
  if (["SUCCEEDED", "COMPLETED", "DONE", "SUCCESS", "FINISHED", "READY"].includes(raw)) return "SUCCEEDED";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(raw)) return "FAILED";
  return raw;
}

function uiStatusLabel(st) {
  if (!st || st === "—") return "—";
  if (st === "IN_QUEUE") return "IN_QUEUE";
  if (st === "IN_PROGRESS") return "IN_PROGRESS";
  if (st === "SUCCEEDED") return "DONE ✅";
  if (st === "FAILED") return "FAILED ❌";
  return st;
}

export default function AvatarStudioPanel() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const userId = session?.user?.id || null;

  const fileRef = useRef(null);
  const pollNonceRef = useRef(0);

  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [thumbUrl, setThumbUrl] = useState("");

  const [pending, setPending] = useState([]);
  const [uploaded, setUploaded] = useState([]);

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
    } catch {}
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
    } catch {}
  }

  useEffect(() => {
    restore();
  }, []);

  useEffect(() => {
    persist();
  }, [name, avatar, uploaded, thumbUrl, job, polling]);

  const uploadedCount = uploaded?.length || 0;
  const pendingCount = pending?.length || 0;
  const totalCount = uploadedCount + pendingCount;

  const runStatus = useMemo(() => normalizeStatus(job || avatar || {}), [job, avatar]);
  const isTraining = runStatus === "IN_QUEUE" || runStatus === "IN_PROGRESS";

  const canCreateOrSave =
    canUse &&
    name.trim().length > 0 &&
    (avatar?.id ? true : pendingCount >= 5);

  const canTrainNow = canUse && !!avatar?.id && uploadedCount >= 5 && !loading && !isTraining;

  async function refreshThumbnail(avatarId) {
    if (!avatarId || !userId) return;

    try {
      const out = await apiGetJson(
        `/api/avatars-get-thumbnail-url?avatar_id=${encodeURIComponent(
          avatarId
        )}&user_id=${encodeURIComponent(userId)}`
      );

      const url = out?.thumb_url || out?.url || out?.signed_url || out?.signedUrl || "";
      setThumbUrl(url || "");
    } catch {}
  }

  async function refreshPhotoUrls(avatarId) {
    if (!avatarId || !userId) return;

    try {
      const out = await apiGetJson(
        `/api/avatars-get-photo-urls?avatar_id=${encodeURIComponent(
          avatarId
        )}&user_id=${encodeURIComponent(userId)}`
      );

      const items = out?.photos || out?.data || out || [];
      if (Array.isArray(items)) setUploaded(items);
    } catch {}
  }

  async function refreshTrainingState(avatarId) {
    if (!avatarId || !userId) return;

    try {
      const out = await apiPost("/api/avatars-get-training-state", {
        avatar_id: avatarId,
        user_id: userId,
      });

      if (out?.avatar && typeof out.avatar === "object") {
        setAvatar((prev) => ({ ...(prev || {}), ...out.avatar }));
      }

      if (out?.job) setJob(out.job);

      const st = normalizeStatus(out?.job || out?.avatar || {});
      if (["SUCCEEDED", "FAILED"].includes(st)) {
        setPolling(false);
      }
    } catch {
      // Si este endpoint aún no existe, no rompemos el panel.
    }
  }

  useEffect(() => {
    if (!canUse || !avatar?.id) return;
    refreshThumbnail(avatar.id);
    refreshPhotoUrls(avatar.id);
    refreshTrainingState(avatar.id);
  }, [canUse, avatar?.id]);

  function onPickOne(e) {
    setErr("");
    setInfo("");

    const f = e.target.files?.[0];
    if (!f) return;

    e.target.value = "";
    setPending((prev) => [...prev, f]);
  }

  function removePending(idx) {
    setPending((prev) => prev.filter((_, i) => i !== idx));
    }
  function clearPending() {
    setPending([]);
  }

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
    setPolling(false);
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
      setBusyLabel(avatar?.id ? "Preparando..." : "Creando avatar...");
      const av = avatar?.id ? avatar : await createAvatarOnly();

      if (pendingCount > 0) {
        setBusyLabel(`Subiendo ${pendingCount} foto(s)...`);
        await uploadPendingForAvatar(av.id, pending);
        setPending([]);
      }

      setBusyLabel("Actualizando miniatura...");
      await refreshThumbnail(av.id);

      setBusyLabel("Actualizando lista...");
      await refreshPhotoUrls(av.id);

      await refreshTrainingState(av.id);

      setBusyLabel("");
      setInfo("Listo ✅ Guardado.");
      persist();
    } catch (e) {
      setBusyLabel("");
      setErr(e.message || "ERROR");
    } finally {
      setLoading(false);
    }
  }

  async function onTrain() {
    setErr("");
    setInfo("");

    if (!avatar?.id) return setErr("Primero crea el avatar.");
    if (!userId) return setErr("No se encontró user_id del usuario.");
    if (uploadedCount < 5) return setErr("Necesitas mínimo 5 fotos SUBIDAS para entrenar.");

    setLoading(true);

    try {
      setBusyLabel("Enviando a RunPod...");

      const out = await apiPost("/api/avatars-train", {
        avatar_id: avatar.id,
        user_id: userId,
      });

      if (out?.avatar) {
        setAvatar((prev) => ({ ...(prev || {}), ...out.avatar }));
      }

      const nextJob = out?.job || out;
      setJob(nextJob);

      pollNonceRef.current += 1;
      setPolling(true);

      setBusyLabel("");
      setInfo("Entrenamiento iniciado. Puede tardar varios minutos.");

      persist({
        avatar: out?.avatar ? { ...(avatar || {}), ...out.avatar } : avatar,
        job: nextJob,
        polling: true,
      });
    } catch (e) {
      setBusyLabel("");
      setErr(e.message || "ERROR");
      setPolling(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let t = null;
    const myNonce = pollNonceRef.current;

    async function tick() {
      if (!polling || !avatar?.id || !userId) return;

      try {
        const out = await apiPost("/api/avatars-poll-runpod", {
          avatar_id: avatar.id,
          user_id: userId,
        });

        if (myNonce !== pollNonceRef.current) return;

        if (out?.avatar) {
          setAvatar((prev) => ({ ...(prev || {}), ...out.avatar }));
        }

        if (out?.job) {
          setJob(out.job);
        } else {
          setJob(out);
        }

        const st = normalizeStatus(out?.job || out?.avatar || out || {});

        if (st === "SUCCEEDED") {
          setPolling(false);
          setInfo("Entrenamiento completado ✅");
          await refreshThumbnail(avatar.id);
          await refreshPhotoUrls(avatar.id);
        } else if (st === "FAILED") {
          setPolling(false);
          setErr(out?.job?.error || out?.avatar?.train_error || out?.error || "Entrenamiento falló.");
        }
      } catch (e) {
        if (myNonce !== pollNonceRef.current) return;
        setPolling(false);
        setErr(e.message || "POLL_ERROR");
      }
    }

    if (polling) {
      tick();
      t = setInterval(tick, 4500);
    }

    return () => {
      if (t) clearInterval(t);
    };
  }, [polling, avatar?.id, userId]);

  const headerStatus = useMemo(() => {
    if (loading && busyLabel) return busyLabel;
    if (isTraining) return `Estado del entrenamiento: ${uiStatusLabel(runStatus)}`;
    if (!avatar?.id) {
      if (pendingCount >= 5) return "Listo para crear ✅";
      return `Agrega mínimo 5 fotos (pendientes: ${pendingCount}/5)`;
    }
    if (uploadedCount >= 5) return "Listo para entrenar ✅";
    return `Sube ${Math.max(0, 5 - uploadedCount)} foto(s) más para entrenar`;
  }, [loading, busyLabel, isTraining, runStatus, avatar?.id, pendingCount, uploadedCount]);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Avatar Studio</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Crea un avatar y entrena un LoRA facial. Esto puede tardar varios minutos.
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
            setThumbUrl("");
            setPending([]);
            setUploaded([]);
            setJob(null);
            setPolling(false);
            setBusyLabel("");
            setErr("");
            setInfo("");
            pollNonceRef.current += 1;
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

      <div className="mt-4 grid gap-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del avatar"
          disabled={!canUse || loading || isTraining}
          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
        />

        {avatar?.id && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs text-neutral-300">
              Avatar: <span className="font-semibold text-white">{avatar?.name || name}</span>
              {" · "}
              Trigger: <span className="font-semibold text-white">{avatar?.trigger || "—"}</span>
            </div>

            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt="thumb"
                className="h-12 w-12 rounded-xl border border-white/10 object-cover"
              />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/5 text-[10px] text-neutral-400">
                —
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-white">Fotos de entrenamiento</div>
              <div className="mt-1 text-xs text-neutral-400">
                Agrega 5 fotos, una por una. La primera subida será la miniatura.
              </div>
            </div>

            <div className="text-xs text-neutral-300">
              Subidas: <span className="font-semibold text-white">{uploadedCount}</span>
              {" · "}
              Pendientes: <span className="font-semibold text-white">{pendingCount}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPickOne}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!canUse || loading || isTraining}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40"
            >
              Agregar 1 foto
            </button>

            <div className="text-xs text-neutral-400">
              Total (subidas + pendientes):{" "}
              <span className="font-semibold text-neutral-200">{totalCount}</span>
            </div>

            {pendingCount > 0 && (
              <button
                type="button"
                onClick={clearPending}
                disabled={!canUse || loading || isTraining}
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40"
              >
                Limpiar pendientes
              </button>
            )}
          </div>

          {pendingCount > 0 && (
            <div className="mt-3 grid gap-2">
              {pending.map((f, idx) => (
                <div
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs text-neutral-200">{f.name}</div>
                    <div className="text-[11px] text-neutral-400">{bytesLabel(f.size)}</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removePending(idx)}
                    disabled={!canUse || loading || isTraining}
                    className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-neutral-200 hover:bg-white/10 disabled:opacity-40"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploadedCount > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {uploaded.map((p, idx) => {
                const url = p?.url || "";
                return (
                  <div
                    key={p?.id || p?.storage_path || idx}
                    className="overflow-hidden rounded-xl border border-white/10 bg-black/40"
                  >
                    {url ? (
                      <img src={url} alt={`photo-${idx}`} className="h-24 w-full object-cover" />
                    ) : (
                      <div className="grid h-24 place-items-center text-xs text-neutral-500">
                        Sin preview
                      </div>
                    )}
                    <div className="p-2 text-[10px] text-neutral-400">
                      {idx === 0 ? "miniatura" : "foto"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onCreateOrSave}
          disabled={!canCreateOrSave || loading || isTraining}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
        >
          {loading && busyLabel ? busyLabel : avatar?.id ? "Guardar cambios" : "Crear avatar"}
        </button>

        {avatar?.id && (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-white">Entrenamiento LoRA (RunPod)</div>
                <div className="mt-1 text-xs text-neutral-400">
                  Cuando tengas 5+ fotos SUBIDAS, puedes entrenar. Puede tardar varios minutos.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200">
                  Estado: <span className="font-semibold text-white">{uiStatusLabel(runStatus)}</span>
                </div>

                <button
                  type="button"
                  onClick={onTrain}
                  disabled={!canTrainNow}
                  className="rounded-xl bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15 disabled:opacity-40"
                >
                  {isTraining ? "Entrenando..." : "Entrenar"}
                </button>
              </div>
            </div>

            {runStatus === "FAILED" && (
              <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
                {job?.error || avatar?.train_error || "Entrenamiento falló. Revisa logs en RunPod."}
              </div>
            )}

            {runStatus === "SUCCEEDED" && (
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                Entrenamiento completado ✅
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
