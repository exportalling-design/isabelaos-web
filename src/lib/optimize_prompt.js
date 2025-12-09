// ---------------------------------------------------------
// optimize_prompt.js – Optimización de prompts con OpenAI
// ---------------------------------------------------------

export async function optimizePrompt(originalPrompt) {
  try {
    const res = await fetch("/api/optimize-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: originalPrompt }),
    });

    const data = await res.json();

    if (!res.ok || !data?.optimized) {
      console.error("Error optimizando prompt:", data);
      return originalPrompt;
    }

    return data.optimized;
  } catch (err) {
    console.error("Fallo en optimizePrompt:", err);
    return originalPrompt;
  }
}
