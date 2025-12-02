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
