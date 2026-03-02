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
  const raw = (job?.status || job?.job_status || job?.state || job?.jobStatus || "").toString().toUpperCase();
  if (!raw) return "—";
  if (["IN_QUEUE", "QUEUED", "QUEUE", "PENDING"].includes(raw)) return "IN_QUEUE";
  if (["IN_PROGRESS", "RUNNING", "PROCESSING", "STARTED"].includes(raw)) return "IN_PROGRESS";
  if (["SUCCEEDED", "COMPLETED", "DONE", "SUCCESS", "FINISHED"].includes(raw)) return "SUCCEEDED";
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

  // Anti-race: evita que un poll viejo pise estado nuevo
  const pollNonceRef = useRef(0);

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
        `/api/avatars-get-thumbnail-url?avatar_id=${encodeURIComponent(avatarId)}&user_id=${encodeURIComponent(
          userId
        )}`
      );
      const url = out?.thumb_url || out?.url || out?.signed_url || out?.signedUrl || "";
      // Importante: si no hay url, seteamos vacío para evitar “thumb viejo”
      setThumbUrl(url || "");
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

  // NUEVO: si tu backend lo expone, esto “re-hidrata” estado real (status, error, jobId)
  async function refreshTrainingState(avatarId) {
    if (!avatarId) return;
    try {
      // Este endpoint lo añadimos abajo (backend). Si aún no existe, esto falla silencioso.
      const out = await apiPost("/api/avatars-get-training-state", { avatar_id: avatarId });
      // Esperado: { ok:true, avatar:{status, train_job_id, train_error}, job?:{...} }
      if (out?.avatar && typeof out.avatar === "object") {
        setAvatar((prev) => ({ ...(prev || {}), ...out.avatar }));
      }
      if (out?.job) setJob(out.job);
      // Si el estado real NO está en progreso, apagamos polling para que nunca se quede pegado.
      const st = normalizeStatus(out?.job || out?.avatar || {});
      if (["SUCCEEDED", "FAILED"].includes(st) || ["DRAFT", "READY", "DONE"].includes((out?.avatar?.status || "").toUpperCase())) {
        setPolling(false);
      }
    } catch {
      // ok
    }
  }

  useEffect(() => {
    if (!canUse) return;
    if (!avatar?.id) return;
    refreshThumbnail(avatar.id);
    refreshPhotoUrls(avatar.id);
    refreshTrainingState(avatar.id); // <- NUEVO
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

  const canCreateOrSave =
    canUse &&
    name.trim().length > 0 &&
    (avatar?.id
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

      // 4) Re-hidratar estado training real
      await refreshTrainingState(av.id);

      setBusyLabel("");
      setInfo("Listo ✅ Guardado. Si la miniatura tarda en verse, es normal: los signed URLs a veces tardan unos segundos.");
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

      // anti-race: incrementa nonce para invalidar polls anteriores
      pollNonceRef.current += 1;
      const myNonce = pollNonceRef.current;

      const out = await apiPost("/api/avatars-train", { avatar_id: avatar.id });

      // Si llegó una respuesta vieja (raro), ignoramos
      if (myNonce !== pollNonceRef.current) return;

      setJob(out?.job || out);
      // Si el backend devuelve status del avatar, lo aplicamos
      if (out?.avatar && typeof out.avatar === "object") {
        setAvatar((prev) => ({ ...(prev || {}), ...out.avatar }));
      }

      setPolling(true);
      setBusyLabel("");
      setInfo("Entrenamiento iniciado. Puede tardar varios minutos.");
    } catch (e) {
      setBusyLabel("");
      setErr(e.message || "ERROR");
      setPolling(false);
    } finally {
      setLoading(false);
    }
  }

  // Polling: usa endpoint poll y apaga SIEMPRE en terminal (SUCCEEDED/FAILED) o si backend reporta que ya no corre
  useEffect(() => {
    let t = null;
    const myNonce = pollNonceRef.current;

    async function tick() {
      if (!polling) return;
      if (!avatar?.id) return;

      try {
        const out = await apiPost("/api/avatars-poll-runpod", { avatar_id: avatar.id });

        // si alguien disparó otro entrenamiento y cambió nonce, no pisamos estado
        if (myNonce !== pollNonceRef.current) return;

        setJob(out?.job || out);
        if (out?.avatar && typeof out.avatar === "object") {
          setAvatar((prev) => ({ ...(prev || {}), ...out.avatar }));
        }

        const st = normalizeStatus(out?.job || out);

        if (st === "SUCCEEDED") {
          setPolling(false);
          setInfo("Entrenamiento completado ✅");
          setErr("");
          await refreshThumbnail(avatar.id);
          await refreshTrainingState(avatar.id);
          return;
        }

        if (st === "FAILED") {
          setPolling(false);
          const msg = out?.error || out?.job?.error || out?.avatar?.train_error || "Entrenamiento falló. Revisa el log del job en RunPod.";
          setErr(msg);
          setInfo("");
          await refreshTrainingState(avatar.id);
          return;
        }

        // Si el endpoint devuelve explícitamente que ya no está corriendo (por ejemplo status DONE/FAILED),
        // apagamos para no quedar pegados aunque runpod no responda bien.
        const avatarStatus = (out?.avatar?.status || "").toString().toUpperCase();
        if (["DONE", "FAILED"].includes(avatarStatus)) {
          setPolling(false);
        }
      } catch (e) {
        // Importante: NO dejar pegado. Mostramos error pero apagamos polling.
        setErr(e.message || "POLL_ERROR");
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
  const runStatus = useMemo(() => {
    const st = normalizeStatus(job);
    if (st === "—") return null;
    return st;
  }, [job]);

  // Considera “entrenando” SI polling=true o si job dice IN_QUEUE/IN_PROGRESS
  const isTraining = useMemo(() => {
    if (polling) return true;
    const st = normalizeStatus(job);
    return ["IN_QUEUE", "IN_PROGRESS"].includes(st);
  }, [polling, job]);

  const headerStatus = useMemo(() => {
    if (loading && busyLabel) return busyLabel;

    // Si hay estado de runpod, úsalo
    if (isTraining) return "IN_PROGRESS (entrenando, puede tardar varios minutos)";

    // Si terminó, reflejar terminal
    if (runStatus === "SUCCEEDED") return "Entrenado ✅";
    if (runStatus === "FAILED") return "Falló ❌";

    if (!avatar?.id) {
      if (pendingCount >= 5) return "Listo para crear ✅";
      return `Agrega mínimo 5 fotos (pendientes: ${pendingCount}/5)`;
    }
    if (uploadedCount >= 5) return "Listo para entrenar ✅";
    return `Sube ${Math.max(0, 5 - uploadedCount)} foto(s) más para entrenar`;
  }, [loading, busyLabel, isTraining, runStatus, avatar?.id, pendingCount, uploadedCount]);

  const canTrainNow = canUse && !!avatar?.id && uploadedCount >= 5 && !loading && !isTraining;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Avatar Studio</h2>
          <p className="text-xs text-neutral-400 mt-1">
            Crea un avatar y entrena un LoRA facial.{" "}
            <span className="text-neutral-300">Esto puede tardar varios minutos.</span>
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
          disabled={!canUse || loading || isTraining}
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

            {/* Estado RunPod compactito */}
            {runStatus && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-neutral-200">
                RunPod: <span className="text-white font-semibold">{uiStatusLabel(runStatus)}</span>
              </div>
            )}
          </div>
        )}

        {/* Picker */}
        <div className="rounded-xl border border-white/10 bg-black/40 p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm text-white font-semibold">Fotos de entrenamiento</div>
            <div className="text-xs text-neutral-400">
              Subidas: <span className="text-neutral-200">{uploadedCount}</span> · Pendientes:{" "}
              <span className="text-neutral-200">{pendingCount}</span> · Total:{" "}
              <span className="text-neutral-200">{totalCount}</span>
            </div>
          </div>

          <div className="mt-2 text-xs text-neutral-400">
            Agrega 5 fotos (una por una). La primera foto <span className="text-neutral-300">SUBIDA</span> se usa como miniatura.
          </div>

          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickOne} />

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!canUse || loading || isTraining}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40"
            >
              Agregar 1 foto
            </button>

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

          {/* Pending list compacta */}
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
        </div>

        {/* Guardar cambios */}
        <button
          type="button"
          onClick={onCreateOrSave}
          disabled={!canCreateOrSave || loading || isTraining}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
        >
          {loading && busyLabel ? busyLabel : "Guardar cambios"}
        </button>

        {/* Entrenamiento */}
        {avatar?.id && (
          <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-white">Entrenamiento LoRA (RunPod)</div>
                <div className="text-xs text-neutral-400 mt-1">
                  Cuando tengas 5+ fotos <span className="text-neutral-300">SUBIDAS</span>, puedes entrenar. Puede tardar varios minutos.
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Estado compacto */}
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200">
                  {runStatus ? (
                    <>
                      Estado: <span className="text-white font-semibold">{uiStatusLabel(runStatus)}</span>
                    </>
                  ) : (
                    <>Estado: <span className="text-neutral-300">—</span></>
                  )}
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

            {/* Si falla, mostramos 1 línea (no JSON) */}
            {runStatus === "FAILED" && (
              <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
                {job?.error || "Entrenamiento falló. Revisa logs en RunPod."}
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
