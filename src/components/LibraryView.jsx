// src/components/LibraryView.jsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import {
  loadGenerationsForUser,
  deleteGenerationFromSupabase,
} from "../lib/generations";

// Buckets (según tu Supabase)
const IMAGE_BUCKET_FALLBACK = "generations";
const VIDEO_BUCKET = "videos";

// Intenta extraer el path de una URL pública de Supabase storage.
// Funciona para URLs tipo: https://xxxx.supabase.co/storage/v1/object/public/<bucket>/<path>
function extractStoragePathFromPublicUrl(url, bucketName) {
  try {
    if (!url) return null;
    const u = new URL(url);
    const parts = u.pathname.split("/");

    // busca ".../object/public/<bucket>/<path...>"
    const idx = parts.findIndex((p) => p === "public");
    if (idx === -1) return null;
    const bucket = parts[idx + 1];
    if (!bucket || (bucketName && bucket !== bucketName)) return null;

    const pathParts = parts.slice(idx + 2);
    const path = pathParts.join("/");
    return path || null;
  } catch {
    return null;
  }
}

export default function LibraryView() {
  const { user } = useAuth();

  const [items, setItems] = useState([]); // {kind,image/video, id, createdAt, src, bucket?, path?, dbId?}
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState("all"); // all | images | videos

  // Carga videos del bucket "videos" dentro de carpeta user.id
  async function loadVideosForUser(userId) {
    // Listamos dentro de /<userId>/
    const { data, error } = await supabase.storage
      .from(VIDEO_BUCKET)
      .list(userId, {
        limit: 100,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (error) {
      console.error("[LibraryView] Error listando videos:", error);
      return [];
    }

    // data = [{ name, id, created_at, updated_at, ... }]
    const mapped = (data || [])
      .filter((obj) => obj?.name) // evita carpetas raras
      .map((obj) => {
        const path = `${userId}/${obj.name}`;
        const pub = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path);
        const url = pub?.data?.publicUrl || "";
        return {
          kind: "video",
          id: `video:${path}`,
          createdAt: obj.created_at || obj.updated_at || new Date().toISOString(),
          src: url,
          bucket: VIDEO_BUCKET,
          path,
        };
      });

    return mapped;
  }

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
        // 1) Imágenes (tabla generations)
        const rows = await loadGenerationsForUser(user.id);

        const imageItems = (rows || [])
          .filter((r) => !!r.image_url)
          .map((row) => {
            // Intentamos detectar bucket/path para poder borrar el archivo también
            const bucketGuess = IMAGE_BUCKET_FALLBACK; // si tu URL viene de ese bucket
            const maybePath = extractStoragePathFromPublicUrl(
              row.image_url,
              bucketGuess
            );

            return {
              kind: "image",
              id: `img:${row.id}`,
              dbId: row.id,
              createdAt: row.created_at,
              src: row.image_url,
              bucket: maybePath ? bucketGuess : null,
              path: maybePath || null,
            };
          });

        // 2) Videos (bucket videos)
        const videoItems = await loadVideosForUser(user.id);

        // 3) Merge + sort por createdAt desc
        const merged = [...videoItems, ...imageItems].sort((a, b) => {
          const ta = new Date(a.createdAt).getTime();
          const tb = new Date(b.createdAt).getTime();
          return tb - ta;
        });

        setItems(merged);
        setSelected(merged.length > 0 ? merged[0] : null);
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
    if (filter === "images") return items.filter((i) => i.kind === "image");
    if (filter === "videos") return items.filter((i) => i.kind === "video");
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

      // A) Si es imagen: borrar fila en tabla (y si podemos, también borrar archivo)
      if (selected.kind === "image") {
        const dbId = selected.dbId;
        if (!dbId) throw new Error("Falta dbId para borrar imagen");

        const okDb = await deleteGenerationFromSupabase(dbId, user.id);
        if (!okDb) throw new Error("No se pudo borrar fila en generations");

        // opcional: si logramos detectar path, borramos archivo storage también
        if (selected.bucket && selected.path) {
          const { error: e2 } = await supabase.storage
            .from(selected.bucket)
            .remove([selected.path]);
          if (e2) {
            console.warn(
              "[LibraryView] Imagen borrada de DB, pero no se pudo borrar archivo:",
              e2
            );
          }
        }
      }

      // B) Si es video: borrar archivo del bucket videos (en carpeta user.id)
      if (selected.kind === "video") {
        if (!selected.bucket || !selected.path) {
          throw new Error("Falta bucket/path para borrar video");
        }

        // seguridad extra: no permitir borrar fuera de carpeta user
        if (!selected.path.startsWith(`${user.id}/`)) {
          throw new Error("Intento de borrar archivo fuera del usuario");
        }

        const { error } = await supabase.storage
          .from(selected.bucket)
          .remove([selected.path]);

        if (error) throw error;
      }

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
            <h2 className="text-lg font-semibold text-white">
              Biblioteca de producción
            </h2>
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
          <p className="mt-4 text-xs text-neutral-400">
            Aún no tienes resultados guardados.
          </p>
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
                {item.kind === "video" ? (
                  <div className="relative h-24 w-full">
                    <video
                      src={item.src}
                      className="h-24 w-full object-cover opacity-90 group-hover:opacity-80"
                      muted
                      playsInline
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
            selected.kind === "video" ? (
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