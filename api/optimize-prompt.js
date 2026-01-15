// /api/optimize-prompt.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Método no permitido" });
    return;
  }

  const { prompt, negative_prompt } = req.body || {};

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ ok: false, error: "Falta 'prompt' en el body" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      ok: false,
      error: "No hay OPENAI_API_KEY configurada en el servidor",
    });
    return;
  }

  const neg = typeof negative_prompt === "string" ? negative_prompt : "";

  try {
    const completionRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres un optimizador de prompts para un generador de imágenes. Devuelves prompts mejorados en inglés, más descriptivos, manteniendo la idea original. No agregues contenido sexual explícito ni violento. No agregues explicación.",
          },
          {
            role: "user",
            content:
              `Prompt original:\n${prompt}\n\n` +
              `Negative prompt original:\n${neg}\n\n` +
              `Devuélveme SOLO el prompt optimizado y el negative optimizado en JSON EXACTO con esta forma:\n` +
              `{"prompt":"...","negative":"..."}`,
          },
        ],
        temperature: 0.9,
        max_tokens: 300,
      }),
    });

    const json = await completionRes.json();
    if (!completionRes.ok) {
      console.error("Respuesta OpenAI:", json);
      res.status(500).json({
        ok: false,
        error: json.error?.message || "Error desde OpenAI",
      });
      return;
    }

    const raw = json.choices?.[0]?.message?.content?.trim() || "";

    // Intentamos parsear JSON. Si falla, fallback: devolvemos prompt original.
    let optimizedPrompt = prompt;
    let optimizedNegative = neg || "";

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.prompt === "string" && parsed.prompt.trim()) optimizedPrompt = parsed.prompt.trim();
        if (typeof parsed.negative === "string") optimizedNegative = parsed.negative.trim();
      }
    } catch (_) {
      // fallback: si no vino JSON, usamos el texto completo como prompt optimizado
      if (raw && raw.length > 0) optimizedPrompt = raw;
      optimizedNegative = neg || "";
    }

    res.status(200).json({
      ok: true,
      optimizedPrompt,
      optimizedNegative,
    });
  } catch (err) {
    console.error("Error en /api/optimize-prompt:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
