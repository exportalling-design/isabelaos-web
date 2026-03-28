// src/components/LibraryView.jsx
// ─────────────────────────────────────────────────────────────
// Biblioteca de producción
// - Muestra imágenes (DB) y videos (Storage)
// - Límite: 20 imágenes / 10 videos por usuario
// - Aviso cuando está cerca del límite (≥80%)
// - Modal de pantalla completa con X para cerrar
// - Botones de descarga y borrado en cada item
// - Al borrar se elimina de Supabase (DB o Storage)
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { loadLibraryForUser, deleteLibraryItem, LIBRARY_LIMITS } from "../lib/generations";

export default function LibraryView() {
  const { user } = useAuth();

  const [items,    setItems]    = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [filter,   setFilter]   = useState("all"); // all | images | videos
  const [modal,    setModal]    = useState(null);  // item abierto en pantalla completa

  useEffect(() => {
    if (!user) { setItems([]); setSelected(null); setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        const merged = await loadLibraryForUser(user.id);
        setItems(Array.isArray(merged) ? merged : []);
        setSelected(merged?.length ? merged[0] : null);
      } catch (e) {
        console.error("[LibraryView]", e);
        setItems([]); setSelected(null);
      } finally { setLoading(false); }
    })();
  }, [user]);

  // ── Conteos ───────────────────────────────────────────────
  const imageCount = useMemo(() => items.filter(i => i.type === "image").length, [items]);
  const videoCount = useMemo(() => items.filter(i => i.type === "video").length, [items]);

  const imageWarning = imageCount >= Math.floor(LIBRARY_LIMITS.images * 0.8);
  const videoWarning = videoCount >= Math.floor(LIBRARY_LIMITS.videos * 0.8);
  const imageFull    = imageCount >= LIBRARY_LIMITS.images;
  const videoFull    = videoCount >= LIBRARY_LIMITS.videos;

  // ── Filtrado ──────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (filter === "images") return items.filter(i => i.type === "image");
    if (filter === "videos") return items.filter(i => i.type === "video");
    return items;
  }, [items, filter]);

  // ── Borrar ────────────────────────────────────────────────
  const handleDelete = async (item, e) => {
    e?.stopPropagation();
    if (!user) return;
    if (!window.confirm("¿Eliminar este archivo? Se borrará permanentemente de tu biblioteca.")) return;
    try {
      setDeleting(true);
      const ok = await deleteLibraryItem(item, user.id);
      if (!ok) throw new Error("No se pudo eliminar.");
      setItems(prev => {
        const next = prev.filter(it => it.id !== item.id);
        if (selected?.id === item.id) setSelected(next.length ? next[0] : null);
        if (modal?.id === item.id)    setModal(null);
        return next;
      });
    } catch (e) {
      console.error("[LibraryView] delete error:", e);
      alert("No se pudo eliminar. Intenta de nuevo.");
    } finally { setDeleting(false); }
  };

  // ── Descargar ─────────────────────────────────────────────
  const handleDownload = (item, e) => {
    e?.stopPropagation();
    if (!item?.src) return;
    const link = document.createElement("a");
    link.href     = item.src;
    link.download = item.type === "video"
      ? `isabelaos-video-${Date.now()}.mp4`
      : `isabelaos-imagen-${Date.now()}.jpg`;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        Inicia sesión para acceder a tu biblioteca de producción.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1.4fr]">

        {/* ── Panel izquierdo: lista ── */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-white">Biblioteca de producción</h2>
              <p className="mt-1 text-xs text-neutral-400">
                Imágenes y videos guardados por tu cuenta.
              </p>
            </div>

            {/* Filtros */}
            <div className="flex gap-2 text-xs flex-wrap">
              {[
                { key: "all",    label: "Todos" },
                { key: "images", label: `Imágenes (${imageCount}/${LIBRARY_LIMITS.images})` },
                { key: "videos", label: `Videos (${videoCount}/${LIBRARY_LIMITS.videos})` },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setFilter(key)}
                  className={`rounded-xl border px-3 py-1.5 transition-all ${
                    filter === key
                      ? "border-cyan-400 bg-cyan-500/10 text-white"
                      : "border-white/10 text-neutral-300 hover:border-white/30"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Avisos de límite ── */}
          {(imageWarning || videoWarning) && (
            <div className={`mt-4 rounded-2xl border px-4 py-3 text-xs ${
              imageFull || videoFull
                ? "border-red-400/40 bg-red-500/10 text-red-200"
                : "border-yellow-400/40 bg-yellow-500/10 text-yellow-200"
            }`}>
              {imageFull && (
                <p>⚠️ Límite de imágenes alcanzado ({LIBRARY_LIMITS.images}/{LIBRARY_LIMITS.images}). Descarga o borra algunas para poder generar más.</p>
              )}
              {videoFull && (
                <p className="mt-1">⚠️ Límite de videos alcanzado ({LIBRARY_LIMITS.videos}/{LIBRARY_LIMITS.videos}). Descarga o borra algunos para poder generar más.</p>
              )}
              {!imageFull && imageWarning && (
                <p>📌 Casi al límite de imágenes ({imageCount}/{LIBRARY_LIMITS.images}). Guarda tus imágenes en tu PC o móvil.</p>
              )}
              {!videoFull && videoWarning && (
                <p className="mt-1">📌 Casi al límite de videos ({videoCount}/{LIBRARY_LIMITS.videos}). Descarga tus videos antes de seguir generando.</p>
              )}
            </div>
          )}

          {/* ── Grid de items ── */}
          {loading ? (
            <p className="mt-4 text-xs text-neutral-400">Cargando historial...</p>
          ) : filteredItems.length === 0 ? (
            <p className="mt-4 text-xs text-neutral-400">
              {filter === "images" ? "No tienes imágenes guardadas." :
               filter === "videos" ? "No tienes videos guardados." :
               "Aún no tienes resultados guardados."}
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredItems.map((item) => (
                <div key={item.id}
                  onClick={() => { setSelected(item); setModal(item); }}
                  className={`group relative cursor-pointer overflow-hidden rounded-xl border transition-all ${
                    selected?.id === item.id ? "border-cyan-400" : "border-white/10 hover:border-white/30"
                  } bg-black/60`}>

                  {/* Thumbnail */}
                  {item.type === "video" ? (
                    <div className="relative h-24 w-full">
                      <video src={item.src} className="h-24 w-full object-cover" muted playsInline preload="metadata" />
                      <div className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] text-white font-semibold">VIDEO</div>
                    </div>
                  ) : (
                    <div className="relative h-24 w-full bg-black/40">
                      <img src={item.src} alt="Generación"
                        className="h-24 w-full object-cover"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </div>
                  )}

                  {/* Fecha */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 px-2 py-1 text-[9px] text-neutral-300">
                    {new Date(item.createdAt).toLocaleString("es", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
                  </div>

                  {/* Botones hover */}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => handleDownload(item, e)}
                      className="rounded-xl bg-cyan-500/80 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-cyan-500">
                      ↓
                    </button>
                    <button onClick={(e) => handleDelete(item, e)} disabled={deleting}
                      className="rounded-xl bg-red-500/80 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50">
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Panel derecho: vista previa ── */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
          <h2 className="text-lg font-semibold text-white">Vista previa</h2>

          <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400 overflow-hidden">
            {selected ? (
              selected.type === "video" ? (
                <video src={selected.src} controls className="h-full w-full rounded-2xl object-contain" />
              ) : (
                <img src={selected.src} alt="Seleccionada"
                  className="h-full w-full rounded-2xl object-contain cursor-zoom-in"
                  onClick={() => setModal(selected)}
                  onError={(e) => { (e.target as HTMLImageElement).alt = "No se pudo cargar"; }} />
              )
            ) : (
              <p>Selecciona un resultado para verlo.</p>
            )}
          </div>

          {/* Botones de acción del item seleccionado */}
          {selected && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button onClick={(e) => handleDownload(selected, e)}
                className="w-full rounded-2xl border border-cyan-400/40 bg-cyan-500/10 py-2 text-xs text-cyan-200 hover:bg-cyan-500/20">
                ↓ Descargar
              </button>
              <button onClick={(e) => handleDelete(selected, e)} disabled={deleting}
                className="w-full rounded-2xl border border-red-500/40 py-2 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-60">
                {deleting ? "Eliminando..." : "🗑 Eliminar"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal pantalla completa ── */}
      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
          onClick={() => setModal(null)}>
          <div className="relative max-w-5xl w-full max-h-[90vh] flex items-center justify-center"
            onClick={e => e.stopPropagation()}>

            {/* X para cerrar */}
            <button onClick={() => setModal(null)}
              className="absolute -top-4 -right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/80 text-white hover:bg-white/10">
              ✕
            </button>

            {modal.type === "video" ? (
              <video src={modal.src} controls autoPlay
                className="max-h-[85vh] w-full rounded-2xl object-contain" />
            ) : (
              <img src={modal.src} alt="Vista completa"
                className="max-h-[85vh] w-full rounded-2xl object-contain" />
            )}

            {/* Botones en el modal */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3">
              <button onClick={(e) => handleDownload(modal, e)}
                className="rounded-2xl border border-cyan-400/40 bg-black/80 px-5 py-2 text-xs text-cyan-200 hover:bg-cyan-500/20 backdrop-blur-sm">
                ↓ Descargar
              </button>
              <button onClick={(e) => handleDelete(modal, e)} disabled={deleting}
                className="rounded-2xl border border-red-400/40 bg-black/80 px-5 py-2 text-xs text-red-200 hover:bg-red-500/10 backdrop-blur-sm disabled:opacity-50">
                🗑 Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
