// src/lib/generations.ts
import { supabase } from "./supabaseClient";

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
    .from("generations")
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

export async function loadGenerationsForUser(userId: string) {
  console.log("[loadGenerationsForUser] Cargando historial:", userId);

  const { data, error } = await supabase
    .from("generations")
    .select("id, image_url, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[loadGenerationsForUser] Error:", error);
    return [];
  }

  console.log("[loadGenerationsForUser] Filas:", data?.length || 0);
  return data || [];
}

/**
 * Devuelve cuántas imágenes ha generado el usuario HOY,
 * usando el inicio del día en horario local.
 */
export async function getTodayGenerationCount(userId: string) {
  console.log("[getTodayGenerationCount] Contando generadas HOY para:", userId);

  const now = new Date();
  // Inicio del día local (Guatemala) y luego a ISO (UTC)
  const startOfDayLocal = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  );

  const { error, count } = await supabase
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfDayLocal.toISOString());

  if (error) {
    console.error("[getTodayGenerationCount] Error:", error);
    return 0;
  }

  console.log("[getTodayGenerationCount] Count =", count ?? 0);
  return count ?? 0;
}
