// src/lib/generations.js
import { supabase } from "./supabaseClient"; // si tu archivo se llama distinto, solo cambia el import

export async function saveGenerationInSupabase({
  userId,
  imageDataUrl,
  prompt,
  negativePrompt,
  width,
  height,
  steps,
}) {
  try {
    const { data, error } = await supabase
      .from("generations")
      .insert({
        user_id: userId,
        image_url: imageDataUrl, // guardamos el data URL completo
        prompt,
        negative_prompt: negativePrompt,
        width,
        height,
        steps,
      })
      .select("id, image_url, prompt, created_at")
      .single();

    if (error) {
      console.error("Error guardando generación:", error);
      return null;
    }

    return data; // { id, image_url, prompt, created_at }
  } catch (e) {
    console.error("Error inesperado guardando generación:", e);
    return null;
  }
}

export async function loadGenerationsForUser(userId) {
  try {
    const { data, error } = await supabase
      .from("generations")
      .select("id, image_url, prompt, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error cargando historial:", error);
      return [];
    }

    return data || [];
  } catch (e) {
    console.error("Error inesperado cargando historial:", e);
    return [];
  }
}
