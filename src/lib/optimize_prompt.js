// src/lib/optimize_prompt.js

export async function optimizePrompt(originalPrompt) {
  try {
    const res = await fetch("/api/optimize-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: originalPrompt }),
    });

    if (!res.ok) {
      console.error("Error HTTP en /api/optimize-prompt:", res.status);
      return originalPrompt;
    }

    const data = await res.json();
    if (!data?.ok || !data.optimizedPrompt) {
      console.warn("Respuesta inesperada de /api/optimize-prompt:", data);
      return originalPrompt;
    }

    // 👉 Devolvemos el texto mejorado
    return data.optimizedPrompt;
  } catch (err) {
    console.error("Error llamando a /api/optimize-prompt:", err);
    return originalPrompt;
  }
}
