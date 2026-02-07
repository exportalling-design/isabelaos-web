// ---------------------------------------------------------
// Biblioteca (LibraryView) – imágenes (DB) + videos (Storage)
// ---------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { loadLibraryForUser, deleteLibraryItem } from "../lib/generations";
import { useAuth } from "../lib/useAuth"; // ajusta si tu hook está en otro lado

function LibraryView() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

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
        const list = await loadLibraryForUser(user.id);
        setItems(list);
        setSelected(list.length > 0 ? list[0] : null);
      } catch (e) {
        console.error("Error cargando biblioteca:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleDeleteSelected = async () => {
    if (!selected || !user) return;

    const ok = window.confirm(
      "¿Seguro que quieres eliminar este resultado? Esto también lo borrará de Supabase (DB o Storage)."
    );
    if (!ok) return;

    try {
      setDeleting(true);
      const success = await deleteLibraryItem(selected, user.id);
      if (!success) {
        alert("No se pudo eliminar. Revisa policies de Storage o permisos.");
        return;
      }

      setItems((prev) => {
        const next = prev.filter((it) => it.id !== selected.id);
        setSelected(next.length > 0 ? next[0] : null);
        return next;
      });
    } catch (e) {
      console.error("Error eliminando:", e);
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
        <h2 className="text-lg font-semibold text-white">Biblioteca de producción</h2>
        <p className="mt-1 text-xs text-neutral-400">Imágenes (DB) + videos (Storage) de tu cuenta.</p>

        {loading ? (
          <p className="mt-4 text-xs text-neutral-400">Cargando historial...</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-xs text-neutral-400">Aún no tienes resultados guardados.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className={`group relative overflow-hidden rounded-xl border ${
                  selected?.id === item.id ? "border-cyan-400" : "border-white/10"
                } bg-black/60`}
              >
                {item.type === "video" ? (
                  <div className="relative">
                    <video
                      src={item.src}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-24 w-full object-cover group-hover:opacity-80"
                    />
                    <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">
                      VIDEO
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <img
                      src={item.src}
                      alt="Generación"
                      className="h-24 w-full object-cover group-hover:opacity-80"
                    />
                    <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">
                      IMG
                    </div>
                  </div>
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
                playsInline
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

export default LibraryView;