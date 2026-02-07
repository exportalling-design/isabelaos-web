// src/lib/generations.ts
import { supabase } from "./supabaseClient";

const IMAGE_TABLE = "generations";
const IMAGE_BUCKET = "generations"; // bucket de imágenes (si usas otro, cámbialo)
const VIDEO_BUCKET = "videos";      // bucket de videos

// Si tus buckets son PUBLIC (como en tu screenshot), deja true.
// Si los vuelves privados, cambia a false y usa signed URLs (más abajo ya está soportado).
const VIDEO_BUCKET_PUBLIC = true;
const IMAGE_BUCKET_PUBLIC = true;

export type LibraryItemType = "image" | "video";

export interface LibraryItem {
  id: string;              // id único para UI (db:xxx o st:bucket:path)
  type: LibraryItemType;   // image | video
  createdAt: string;       // ISO
  src: string;             // URL para mostrar
  bucket?: string;         // storage bucket
  path?: string;           // storage path dentro del bucket
  dbId?: string;           // id de fila en DB si existe
}

export interface GenerationParams {
  userId: string;
  imageUrl: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
}

export async function saveGenerationInSupabase(params: GenerationParams) {
  const { userId, imageUrl, prompt, negativePrompt, width, height, steps } = params;

  console.log("[saveGenerationInSupabase] Guardando fila...", {
    userId,
    hasImage: !!imageUrl,
    width,
    height,
    steps,
  });

  const { data, error } = await supabase
    .from(IMAGE_TABLE)
    .insert({
      user_id: userId,
      image_url: imageUrl,
      prompt,
      negative_prompt: negativePrompt,
      width,
      height,
      steps,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[saveGenerationInSupabase] Error:", error);
    return null;
  }

  console.log("[saveGenerationInSupabase] OK:", data);
  return data;
}

/**
 * Carga imágenes desde DB (tabla generations).
 */
export async function loadImageGenerationsForUser(userId: string) {
  console.log("[loadImageGenerationsForUser] Cargando historial imágenes:", userId);

  const { data, error } = await supabase
    .from(IMAGE_TABLE)
    .select("id, image_url, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[loadImageGenerationsForUser] Error:", error);
    return [];
  }

  return data || [];
}

/**
 * Lista videos dentro del bucket por carpeta del usuario: videos/{userId}/...
 * IMPORTANTE: tus policies deben permitir que cada usuario solo liste/borré su carpeta.
 */
export async function listUserVideosFromStorage(userId: string, limit = 50) {
  console.log("[listUserVideosFromStorage] Listing videos for:", userId);

  // list() lista objetos dentro de una "carpeta" (prefix)
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .list(userId, {
      limit,
      sortBy: { column: "created_at", order: "desc" },
    });

  if (error) {
    console.error("[listUserVideosFromStorage] Error:", error);
    return [];
  }

  const files = (data || [])
    .filter((f) => !!f.name)
    .filter((f) => f.name.toLowerCase().endsWith(".mp4") || f.name.toLowerCase().endsWith(".webm") || f.name.toLowerCase().endsWith(".mov"))
    .map((f) => ({
      name: f.name,
      created_at: (f.created_at as any) || new Date().toISOString(),
    }));

  // Generar URLs
  const out: LibraryItem[] = [];

  for (const f of files) {
    const path = `${userId}/${f.name}`;

    if (VIDEO_BUCKET_PUBLIC) {
      const { data: pub } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path);
      out.push({
        id: `st:${VIDEO_BUCKET}:${path}`,
        type: "video",
        createdAt: f.created_at || new Date().toISOString(),
        src: pub.publicUrl,
        bucket: VIDEO_BUCKET,
        path,
      });
    } else {
      // Signed URL (si vuelves bucket privado)
      const { data: signed, error: sErr } = await supabase.storage
        .from(VIDEO_BUCKET)
        .createSignedUrl(path, 60 * 30); // 30 min

      if (sErr || !signed?.signedUrl) continue;

      out.push({
        id: `st:${VIDEO_BUCKET}:${path}`,
        type: "video",
        createdAt: f.created_at || new Date().toISOString(),
        src: signed.signedUrl,
        bucket: VIDEO_BUCKET,
        path,
      });
    }
  }

  return out;
}

/**
 * (Opcional) Si también guardas MP4 dentro del bucket "generations/{userId}/..."
 * lo listamos para que aparezcan igualmente.
 */
export async function listUserVideosFromGenerationsBucket(userId: string, limit = 50) {
  console.log("[listUserVideosFromGenerationsBucket] Listing mp4 in generations for:", userId);

  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .list(userId, {
      limit,
      sortBy: { column: "created_at", order: "desc" },
    });

  if (error) {
    console.error("[listUserVideosFromGenerationsBucket] Error:", error);
    return [];
  }

  const files = (data || [])
    .filter((f) => !!f.name)
    .filter((f) => f.name.toLowerCase().endsWith(".mp4") || f.name.toLowerCase().endsWith(".webm") || f.name.toLowerCase().endsWith(".mov"))
    .map((f) => ({
      name: f.name,
      created_at: (f.created_at as any) || new Date().toISOString(),
    }));

  const out: LibraryItem[] = [];

  for (const f of files) {
    const path = `${userId}/${f.name}`;

    if (IMAGE_BUCKET_PUBLIC) {
      const { data: pub } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      out.push({
        id: `st:${IMAGE_BUCKET}:${path}`,
        type: "video",
        createdAt: f.created_at || new Date().toISOString(),
        src: pub.publicUrl,
        bucket: IMAGE_BUCKET,
        path,
      });
    } else {
      const { data: signed, error: sErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .createSignedUrl(path, 60 * 30);

      if (sErr || !signed?.signedUrl) continue;

      out.push({
        id: `st:${IMAGE_BUCKET}:${path}`,
        type: "video",
        createdAt: f.created_at || new Date().toISOString(),
        src: signed.signedUrl,
        bucket: IMAGE_BUCKET,
        path,
      });
    }
  }

  return out;
}

/**
 * Biblioteca total:
 * - imágenes desde DB
 * - videos desde Storage (videos bucket + opcional generations bucket)
 */
export async function loadLibraryForUser(userId: string): Promise<LibraryItem[]> {
  const rows = await loadImageGenerationsForUser(userId);

  const images: LibraryItem[] = (rows || [])
    .filter((r: any) => !!r.image_url)
    .map((r: any) => ({
      id: `db:${r.id}`,
      dbId: r.id,
      type: "image",
      createdAt: r.created_at,
      src: r.image_url,
    }));

  const [videosA, videosB] = await Promise.all([
    listUserVideosFromStorage(userId, 50),
    listUserVideosFromGenerationsBucket(userId, 50),
  ]);

  // Merge y ordenar por createdAt desc
  const merged = [...videosA, ...videosB, ...images].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });

  // limitar si quieres
  return merged.slice(0, 80);
}

/**
 * Borra un item:
 * - si es imagen (DB): borra la fila
 * - si es video (storage): borra el archivo del bucket/path
 *
 * IMPORTANTE: esto depende de tus Storage Policies:
 * el usuario debe poder borrar SOLO dentro de su carpeta (userId/).
 */
export async function deleteLibraryItem(item: LibraryItem, userId: string): Promise<boolean> {
  console.log("[deleteLibraryItem] Deleting:", item);

  if (item.type === "image") {
    if (!item.dbId) return false;

    const { error } = await supabase
      .from(IMAGE_TABLE)
      .delete()
      .eq("id", item.dbId)
      .eq("user_id", userId);

    if (error) {
      console.error("[deleteLibraryItem] DB delete error:", error);
      return false;
    }

    return true;
  }

  // video (storage)
  if (item.bucket && item.path) {
    // Seguridad extra: jamás permitas borrar fuera del folder del usuario
    if (!item.path.startsWith(`${userId}/`)) {
      console.warn("[deleteLibraryItem] Blocked delete outside user folder:", item.path);
      return false;
    }

    const { error } = await supabase.storage.from(item.bucket).remove([item.path]);
    if (error) {
      console.error("[deleteLibraryItem] Storage remove error:", error);
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Devuelve cuántas imágenes ha generado el usuario HOY (sin tocar)
 */
export async function getTodayGenerationCount(userId: string) {
  console.log("[getTodayGenerationCount] Contando generadas HOY para:", userId);

  const now = new Date();
  const startOfDayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  const { error, count } = await supabase
    .from(IMAGE_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfDayLocal.toISOString());

  if (error) {
    console.error("[getTodayGenerationCount] Error:", error);
    return 0;
  }

  return count ?? 0;
}

// ---------------------------------------------------------
// COMPAT: exports viejos para no romper App.jsx
// ---------------------------------------------------------
export async function loadGenerationsForUser(userId: string) {
  // Antes traía solo imágenes.
  // Ahora devolvemos la librería completa (imágenes + videos)
  return loadLibraryForUser(userId);
}

export async function deleteGenerationFromSupabase(id: string, userId: string) {
  // Compat: borra solo filas DB (imágenes)
  const { error } = await supabase
    .from("generations")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  return !error;
}