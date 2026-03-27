import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

const LS_KEY = "isabelaos_anchorstudio_state_v1";

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

function FaceGuideExample() {
  return (
    <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/10 via-white/5 to-fuchsia-500/10 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400/15 text-sm">
          📸
        </div>
        <div>
          <div className="text-sm font-semibold text-white">
            Ejemplo visual recomendado
          </div>
          <div className="text-[11px] text-neutral-300">
            Usa una foto similar a esta para mejores resultados con el anchor
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[220px]">
          <div className="overflow-hidden rounded-2xl border border-cyan-300/25 bg-black/30 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
            <img
              src="/gallery/img17.png"
              alt="Ejemplo foto anchor"
              className="h-[260px] w-full object-cover"
            />
          </div>
          <div className="mt-2 text-center text-[11px] text-cyan-200">
            Ejemplo correcto
          </div>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                Sí funciona mejor
              </div>
              <ul className="mt-2 space-y-1.5 text-[12px] text-emerald-100">
                <li>• Cara de frente</li>
                <li>• Fondo blanco o neutro</li>
                <li>• Buena luz sin sombras duras</li>
                <li>• Rostro grande y centrado</li>
                <li>• Expresión natural o ligera sonrisa</li>
              </ul>
            </div>

            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-300">
                Evítalo
              </div>
              <ul className="mt-2 space-y-1.5 text-[12px] text-rose-100">
                <li>• Selfies lejanas</li>
                <li>• Fotos de cuerpo completo</li>
                <li>• Lentes o manos tapando la cara</li>
                <li>• Cabello cubriendo ojos o mejillas</li>
                <li>• Fondos cargados o muy oscuros</li>
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-300">
              Tamaño ideal del archivo
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-white/5 p-2 text-center">
                <div className="text-sm font-semibold text-white">512 × 512</div>
                <div className="text-[11px] text-neutral-400">mínimo</div>
              </div>

              <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-2 text-center">
                <div className="text-sm font-semibold text-cyan-200">
                  768 × 768
                </div>
                <div className="text-[11px] text-cyan-100">recomendado</div>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/5 p-2 text-center">
                <div className="text-sm font-semibold text-white">JPG / PNG</div>
                <div className="text-[11px] text-neutral-400">
                  formatos válidos
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-yellow-400/20 bg-yellow-500/10 p-3 text-[12px] text-yellow-100">
            <span className="font-semibold text-yellow-200">Tip pro:</span> si
            subes 2 o 3 fotos, intenta que todas tengan el mismo estilo:
            encuadre parecido, luz parecida y fondo limpio. Eso ayuda a que
            Instaface y FaceSwap respeten mejor la identidad.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AvatarStudioPanel() {
  const { session } = useAuth();
  const token = session?.access_token || null;
  const userId = session?.user?.id || null;

  const fileRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [thumbUrl, setThumbUrl] = useState("");

  const [pending, setPending] = useState([]);
  const [uploaded, setUploaded] = useState([]);

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
      ...next,
    };

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {}
  }

  function restore() {
    const raw =
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (!raw) return;

    const st = safeParse(raw);
    if (!st) return;

    if (typeof st.name === "string") setName(st.name);
    if (st.avatar && typeof st.avatar === "object") setAvatar(st.avatar);
    if (Array.isArray(st.uploaded)) setUploaded(st.uploaded);
    if (typeof st.thumbUrl === "string") setThumbUrl(st.thumbUrl);
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
  }, [name, avatar, uploaded, thumbUrl]);

  const uploadedCount = uploaded?.length || 0;
  const pendingCount = pending?.length || 0;
  const totalCount = uploadedCount + pendingCount;

  const canCreateOrSave =
    canUse &&
    name.trim().length > 0 &&
    (avatar?.id ? true : pendingCount >= 1);

  async function refreshThumbnail(avatarId) {
    if (!avatarId || !userId) return;

    try {
      const out = await apiGetJson(
        `/api/avatars-get-thumbnail-url?avatar_id=${encodeURIComponent(
          avatarId
        )}&user_id=${encodeURIComponent(userId)}`
      );

      const url =
        out?.thumb_url ||
        out?.url ||
        out?.signed_url ||
        out?.signedUrl ||
        "";

      setThumbUrl(url || "");
    } catch {
      setThumbUrl("");
    }
  }

  async function refreshAnchorUrls(avatarId) {
    if (!avatarId) return;

    try {
      const out = await apiGetJson(
        `/api/avatars-get-anchor-urls?avatar_id=${encodeURIComponent(avatarId)}`
      );

      const items = out?.anchors || out?.data || [];
      if (Array.isArray(items)) {
        setUploaded(items);
      } else {
        setUploaded([]);
      }
    } catch {
      setUploaded([]);
    }
  }

  useEffect(() => {
    if (!canUse || !avatar?.id) return;
    refreshThumbnail(avatar.id);
    refreshAnchorUrls(avatar.id);
  }, [canUse, avatar?.id]);

  function onPickOne(e) {
    setErr("");
    setInfo("");

    const f = e.target.files?.[0];
    if (!f) return;

    if ((pending?.length || 0) >= 3) {
      setErr("Solo puedes agregar hasta 3 fotos.");
      e.target.value = "";
      return;
    }

    if (uploadedCount + pendingCount >= 3) {
      setErr("Solo puedes tener hasta 3 fotos anchor.");
      e.target.value = "";
      return;
    }

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
    return created;
  }

  async function uploadPendingForAvatar(avatarId, filesArr) {
    const results = [];

    for (let i = 0; i < filesArr.length; i++) {
      const file = filesArr[i];
      const dataUrl = await fileToDataURL(file);

      const out = await apiPost("/api/avatars-upload-anchor-photo", {
        avatar_id: avatarId,
        image_b64: dataUrl,
        anchor_index: i + 1,
      });

      results.push({
        anchor_index: out.anchor_index,
        storage_path: out.storage_path,
        url: out.signed_url,
      });
    }

    return results;
  }

  async function onCreateOrSave() {
    setErr("");
    setInfo("");

    if (!canUse) return setErr("Debes iniciar sesión.");
    if (!name.trim()) return setErr("Falta nombre del anchor.");

    if (!avatar?.id && pendingCount < 1) {
      return setErr("Agrega mínimo 1 foto. Puedes subir hasta 3.");
    }

    setLoading(true);

    try {
      setBusyLabel(avatar?.id ? "Guardando..." : "Creando anchor...");
      const av = avatar?.id ? avatar : await createAvatarOnly();

      if (pendingCount > 0) {
        setBusyLabel(`Subiendo ${pendingCount} foto(s)...`);
        await uploadPendingForAvatar(av.id, pending);
        setPending([]);
      }

      setBusyLabel("Actualizando miniatura...");
      await refreshThumbnail(av.id);

      setBusyLabel("Actualizando fotos anchor...");
      await refreshAnchorUrls(av.id);

      setBusyLabel("");
      setInfo("Listo ✅ Anchor guardado.");
      persist();
    } catch (e) {
      setBusyLabel("");
      setErr(e.message || "ERROR");
    } finally {
      setLoading(false);
    }
  }

  const headerStatus = useMemo(() => {
    if (loading && busyLabel) return busyLabel;

    if (!avatar?.id) {
      if (pendingCount >= 1) return "Listo para crear ✅";
      return `Agrega de 1 a 3 fotos (pendientes: ${pendingCount}/3)`;
    }

    if (uploadedCount >= 1) {
      return `Anchor listo ✅ (${uploadedCount}/3 fotos guardadas)`;
    }

    return "Anchor creado. Sube de 1 a 3 fotos.";
  }, [loading, busyLabel, avatar?.id, pendingCount, uploadedCount]);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/60 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Anchor Studio</h2>
          <p className="mt-1 text-xs text-neutral-400">
            Guarda 1 a 3 fotos de rostro para usar como referencia facial.
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
            setBusyLabel("");
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
          Inicia sesión para crear anchors.
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

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-4">
          <div className="text-sm font-semibold text-yellow-200">
            Requisitos de las fotos
          </div>

          <div className="mt-2 text-[12px] text-yellow-50/90">
            Para que Instaface y FaceSwap detecten bien el rostro y lo respeten
            mejor al generar imágenes, sube fotos con estas características:
          </div>

          <ul className="mt-3 grid gap-1.5 text-[12px] text-yellow-50/95 sm:grid-cols-2">
            <li>• Rostro centrado</li>
            <li>• Fondo limpio o blanco</li>
            <li>• Sin lentes ni manos tapando</li>
            <li>• Sin cabello cubriendo la cara</li>
            <li>• Buena iluminación</li>
            <li>• Expresión neutra o ligera sonrisa</li>
            <li>• Rostro ocupando ~70% de la imagen</li>
            <li>• Evita fotos lejanas o de cuerpo completo</li>
          </ul>

          <FaceGuideExample />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-semibold text-white">
            Crear y guardar anchor
          </div>
          <div className="mt-1 text-xs text-neutral-400">
            Aquí colocas el nombre, subes las fotos y guardas el anchor.
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-xs font-medium text-neutral-300">
              Nombre del anchor
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Isabela rostro 1"
              disabled={!canUse || loading}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-neutral-500"
            />
          </div>

          {avatar?.id && (
            <div className="mt-4 flex items-center gap-3 flex-wrap rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="text-xs text-neutral-300">
                Anchor:
                {" "}
                <span className="font-semibold text-white">
                  {avatar?.name || name}
                </span>
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

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-white">
                  Fotos anchor
                </div>
                <div className="mt-1 text-xs text-neutral-400">
                  Sube de 1 a 3 fotos. La primera puede usarse como miniatura.
                </div>
              </div>

              <div className="text-xs text-neutral-300">
                Guardadas:{" "}
                <span className="font-semibold text-white">{uploadedCount}</span>
                {" · "}
                Pendientes:{" "}
                <span className="font-semibold text-white">{pendingCount}</span>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onPickOne}
                className="hidden"
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!canUse || loading || totalCount >= 3}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40"
                >
                  Agregar 1 foto
                </button>

                {pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={clearPending}
                    disabled={!canUse || loading}
                    className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40"
                  >
                    Limpiar pendientes
                  </button>
                )}
              </div>

              <div className="mt-3 text-xs text-neutral-400">
                Total (guardadas + pendientes):{" "}
                <span className="font-semibold text-neutral-200">
                  {totalCount}
                </span>
              </div>

              <div className="mt-1 text-[11px] text-neutral-500">
                Formatos recomendados: JPG o PNG
              </div>
            </div>

            {pendingCount > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-neutral-300">
                  Pendientes por subir
                </div>

                <div className="grid gap-2">
                  {pending.map((f, idx) => (
                    <div
                      key={`${f.name}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs text-neutral-200">
                          {f.name}
                        </div>
                        <div className="text-[11px] text-neutral-400">
                          {bytesLabel(f.size)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removePending(idx)}
                        disabled={!canUse || loading}
                        className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-neutral-200 hover:bg-white/10 disabled:opacity-40"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {uploadedCount > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium text-neutral-300">
                  Fotos guardadas
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {uploaded.map((p, idx) => {
                    const url = p?.url || "";
                    return (
                      <div
                        key={p?.id || p?.storage_path || idx}
                        className="overflow-hidden rounded-xl border border-white/10 bg-black/40"
                      >
                        {url ? (
                          <img
                            src={url}
                            alt={`anchor-${idx}`}
                            className="h-28 w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-28 place-items-center text-xs text-neutral-500">
                            Sin preview
                          </div>
                        )}

                        <div className="p-2 text-[10px] text-neutral-400">
                          {idx === 0
                            ? "anchor 1 / miniatura"
                            : `anchor ${idx + 1}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-5">
              <button
                type="button"
                onClick={onCreateOrSave}
                disabled={!canCreateOrSave || loading}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
              >
                {loading && busyLabel
                  ? busyLabel
                  : avatar?.id
                  ? "Guardar cambios"
                  : "Crear anchor"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
