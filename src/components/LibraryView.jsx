// src/components/LibraryView.jsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { loadLibraryForUser, deleteLibraryItem } from "../lib/generations";

export default function LibraryView() {
  const { user } = useAuth();

  // LibraryItem[] desde generations.ts
  // { id, type: "image"|"video", createdAt, src, bucket?, path?, dbId? }
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState("all"); // all | images | videos

  useEffect(() => {
    if (!user) {
      setItems([]);
      setSelected(null);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const merged = await loadLibraryForUser(user.id);

        setItems(Array.isArray(merged) ? merged : []);
        setSelected(merged?.length ? merged[0] : null);
      } catch (e) {
        console.error("[LibraryView] Error cargando biblioteca:", e);
        setItems([]);
        setSelected(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const filteredItems = useMemo(() => {
    if (filter === "images") return items.filter((i) => i.type === "image");
    if (filter === "videos") return items.filter((i) => i.type === "video");
    return items;
  }, [items, filter]);

  const handleDeleteSelected = async () => {
    if (!selected || !user) return;

    const ok = window.confirm(
      "¿Seguro que quieres eliminar este resultado? Esto también lo borrará de Supabase."
    );
    if (!ok) return;

    try {
      setDeleting(true);

      const okDel = await deleteLibraryItem(selected, user.id);
      if (!okDel) throw new Error("No se pudo eliminar (policy o datos incompletos).");

      // actualizar UI
      setItems((prev) => {
        const next = prev.filter((it) => it.id !== selected.id);
        setSelected(next.length > 0 ? next[0] : null);
        return next;
      });
    } catch (e) {
      console.error("[LibraryView] Error eliminando:", e);
      alert("No se pudo eliminar. Intenta de nuevo.");
    } finally {
      setDeleting(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded-3xl border border-yellow-400/30 bg-yellow-500/5 p-6 text-center text-sm text-yellow-100">
        Inicia sesión para acceder a tu biblioteca de producción.
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1.4fr]">
      <div className="rounded-3xl border border-white/10 bg-black/40 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Biblioteca de producción</h2>
            <p className="mt-1 text-xs text-neutral-400">
              Imágenes y videos guardados por tu cuenta.
            </p>
          </div>

          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setFilter("all")}
              className={`rounded-xl border px-3 py-1 ${
                filter === "all"
                  ? "border-cyan-400 text-white"
                  : "border-white/10 text-neutral-300"
              }`}
            >
              Todo
            </button>
            <button
              onClick={() => setFilter("images")}
              className={`rounded-xl border px-3 py-1 ${
                filter === "images"
                  ? "border-cyan-400 text-white"
                  : "border-white/10 text-neutral-300"
              }`}
            >
              Imágenes
            </button>
            <button
              onClick={() => setFilter("videos")}
              className={`rounded-xl border px-3 py-1 ${
                filter === "videos"
                  ? "border-cyan-400 text-white"
                  : "border-white/10 text-neutral-300"
              }`}
            >
              Videos
            </button>
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-xs text-neutral-400">Cargando historial...</p>
        ) : filteredItems.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-400">Aún no tienes resultados guardados.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className={`group relative overflow-hidden rounded-xl border ${
                  selected?.id === item.id ? "border-cyan-400" : "border-white/10"
                } bg-black/60`}
              >
                {item.type === "video" ? (
                  <div className="relative h-24 w-full">
                    <video
                      src={item.src}
                      className="h-24 w-full object-cover opacity-90 group-hover:opacity-80"
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white">
                      VIDEO
                    </div>
                  </div>
                ) : (
                  <img
                    src={item.src}
                    alt="Generación"
                    className="h-24 w-full object-cover group-hover:opacity-80"
                    loading="lazy"
                  />
                )}

                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[10px] text-neutral-300">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-white/10 bg-black/40 p-6 flex flex-col">
        <h2 className="text-lg font-semibold text-white">Vista previa</h2>

        <div className="mt-4 flex h-[420px] flex-1 items-center justify-center rounded-2xl bg-black/70 text-sm text-neutral-400 overflow-hidden">
          {selected ? (
            selected.type === "video" ? (
              <video
                src={selected.src}
                controls
                className="h-full w-full rounded-2xl object-contain"
              />
            ) : (
              <img
                src={selected.src}
                alt="Seleccionada"
                className="h-full w-full rounded-2xl object-contain"
              />
            )
          ) : (
            <p>Selecciona un resultado para verlo.</p>
          )}
        </div>

        {selected && (
          <button
            onClick={handleDeleteSelected}
            disabled={deleting}
            className="mt-4 w-full rounded-2xl border border-red-500/60 py-2 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-60"
          >
            {deleting ? "Eliminando..." : "Eliminar de mi biblioteca"}
          </button>
        )}
      </div>
    </div>
  );
}