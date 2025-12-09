// api/optimize-prompt.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Método no permitido" });
    return;
  }

  const { prompt } = req.body || {};
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

  try {
    const completionRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
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
                "Eres un optimizador de prompts para un generador de imágenes. Mejora el prompt haciéndolo más descriptivo, en inglés, manteniendo la idea original, sin agregar contenido sexual explícito ni violento.",
            },
            {
              role: "user",
              content: `Prompt original: "${prompt}"\n\nDevuélveme SOLO el prompt optimizado, sin explicación.`,
            },
          ],
          temperature: 0.9,
          max_tokens: 200,
        }),
      }
    );

    const json = await completionRes.json();
    if (!completionRes.ok) {
      console.error("Respuesta OpenAI:", json);
      res.status(500).json({
        ok: false,
        error: json.error?.message || "Error desde OpenAI",
      });
      return;
    }

    const optimized =
      json.choices?.[0]?.message?.content?.trim() || prompt;

    res.status(200).json({
      ok: true,
      optimizedPrompt: optimized,
    });
  } catch (err) {
    console.error("Error en /api/optimize-prompt:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
