// src/lib/generations.ts
import { supabase } from "./supabaseClient";
 
const IMAGE_TABLE   = "generations";
const IMAGE_BUCKET  = "generations";
const VIDEO_BUCKET  = "videos";
const VIDEO_BUCKET_PUBLIC = true;
const IMAGE_BUCKET_PUBLIC = true;
 
// ── Subir imagen base64 a Storage y devolver URL pública ──────
export async function uploadImageToStorage(
  userId: string,
  base64: string,
  mimeType: string = 'image/jpeg'
): Promise<string | null> {
  try {
    // Convertir base64 a Uint8Array
    const byteString = atob(base64.replace(/^data:[^;]+;base64,/, ''));
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
 
    const ext      = mimeType.includes('png') ? 'png' : 'jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const path     = `${userId}/${filename}`;
 
    const { error } = await supabase.storage
      .from('generations')
      .upload(path, bytes, { contentType: mimeType, upsert: false });
 
    if (error) { console.error('[uploadImageToStorage]', error); return null; }
 
    const { data } = supabase.storage.from('generations').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e) {
    console.error('[uploadImageToStorage] exception:', e);
    return null;
  }
}
 
 
// ── Límites por usuario ───────────────────────────────────────
export const LIBRARY_LIMITS = {
  images: 20,
  videos: 10,
};
 
export type LibraryItemType = "image" | "video";
 
export interface LibraryItem {
  id:        string;
  type:      LibraryItemType;
  createdAt: string;
  src:       string;
  bucket?:   string;
  path?:     string;
  dbId?:     string;
}
 
export interface GenerationParams {
  userId:                  string;
  imageUrl:                string;
  prompt:                  string;
  negativePrompt:          string;
  width:                   number;
  height:                  number;
  steps:                   number;
  optimizedPrompt?:        string | null;
  optimizedNegativePrompt?:string | null;
  usedOptimizer?:          boolean;
}
 
export async function saveGenerationInSupabase(params: GenerationParams) {
  const { userId, imageUrl, prompt, negativePrompt, width, height, steps,
          optimizedPrompt, optimizedNegativePrompt, usedOptimizer } = params;
 
  const { data, error } = await supabase
    .from(IMAGE_TABLE)
    .insert({
      user_id:          userId,
      image_url:        imageUrl,
      prompt,
      negative_prompt:  negativePrompt,
      width,
      height,
      steps,
      optimized_prompt:          optimizedPrompt          ?? null,
      optimized_negative_prompt: optimizedNegativePrompt  ?? null,
      used_optimizer:            usedOptimizer            ?? false,
    })
    .select("*")
    .single();
 
  if (error) { console.error("[saveGenerationInSupabase] Error:", error); return null; }
  return data;
}
 
// ── Contar imágenes del usuario ───────────────────────────────
export async function countUserImages(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from(IMAGE_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) return 0;
  return count ?? 0;
}
 
// ── Contar videos del usuario ─────────────────────────────────
export async function countUserVideos(userId: string): Promise<number> {
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).list(userId, { limit: 200 });
  if (error) return 0;
  return (data || []).filter(f => /\.(mp4|webm|mov)$/i.test(f.name)).length;
}
 
// ── Cargar imágenes desde DB ──────────────────────────────────
export async function loadImageGenerationsForUser(userId: string) {
  const { data, error } = await supabase
    .from(IMAGE_TABLE)
    .select("id, image_url, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(LIBRARY_LIMITS.images + 10); // traer un poco más para mostrar aviso
  if (error) { console.error("[loadImageGenerationsForUser]", error); return []; }
  return data || [];
}
 
// ── Cargar videos desde Storage ───────────────────────────────
export async function listUserVideosFromStorage(userId: string): Promise<LibraryItem[]> {
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .list(userId, { limit: LIBRARY_LIMITS.videos + 5, sortBy: { column: "created_at", order: "desc" } });
  if (error) { console.error("[listUserVideosFromStorage]", error); return []; }
 
  const files = (data || [])
    .filter(f => !!f.name && /\.(mp4|webm|mov)$/i.test(f.name))
    .map(f => ({ name: f.name, created_at: (f as any).created_at || new Date().toISOString() }));
 
  const out: LibraryItem[] = [];
  for (const f of files) {
    const path = `${userId}/${f.name}`;
    if (VIDEO_BUCKET_PUBLIC) {
      const { data: pub } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path);
      out.push({ id: `st:${VIDEO_BUCKET}:${path}`, type: "video",
        createdAt: f.created_at, src: pub.publicUrl, bucket: VIDEO_BUCKET, path });
    } else {
      const { data: signed, error: sErr } = await supabase.storage
        .from(VIDEO_BUCKET).createSignedUrl(path, 60 * 30);
      if (sErr || !signed?.signedUrl) continue;
      out.push({ id: `st:${VIDEO_BUCKET}:${path}`, type: "video",
        createdAt: f.created_at, src: signed.signedUrl, bucket: VIDEO_BUCKET, path });
    }
  }
  return out;
}
 
// ── Biblioteca completa ───────────────────────────────────────
export async function loadLibraryForUser(userId: string): Promise<LibraryItem[]> {
  const [rows, videos] = await Promise.all([
    loadImageGenerationsForUser(userId),
    listUserVideosFromStorage(userId),
  ]);
 
  const images: LibraryItem[] = (rows || [])
    .filter((r: any) => !!r.image_url)
    .map((r: any) => ({
      id: `db:${r.id}`, dbId: r.id, type: "image" as const,
      createdAt: r.created_at, src: r.image_url,
    }));
 
  return [...videos, ...images].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
 
// ── Borrar item (imagen de DB o video de storage) ─────────────
export async function deleteLibraryItem(item: LibraryItem, userId: string): Promise<boolean> {
  if (item.type === "image") {
    if (!item.dbId) return false;
    const { error } = await supabase.from(IMAGE_TABLE)
      .delete().eq("id", item.dbId).eq("user_id", userId);
    if (error) { console.error("[deleteLibraryItem] DB error:", error); return false; }
    return true;
  }
  if (item.bucket && item.path) {
    if (!item.path.startsWith(`${userId}/`)) return false;
    const { error } = await supabase.storage.from(item.bucket).remove([item.path]);
    if (error) { console.error("[deleteLibraryItem] Storage error:", error); return false; }
    return true;
  }
  return false;
}
 
// ── Contador diario ───────────────────────────────────────────
export async function getTodayGenerationCount(userId: string) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const { error, count } = await supabase.from(IMAGE_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfDay.toISOString());
  if (error) return 0;
  return count ?? 0;
}
 
// ── Compat ────────────────────────────────────────────────────
export async function loadGenerationsForUser(userId: string) {
  return loadLibraryForUser(userId);
}
 
export async function deleteGenerationFromSupabase(id: string, userId: string) {
  const { error } = await supabase.from("generations")
    .delete().eq("id", id).eq("user_id", userId);
  return !error;
}
