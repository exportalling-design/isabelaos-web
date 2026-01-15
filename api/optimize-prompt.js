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

  // helpers para parse robusto
  const stripCodeFences = (s) => {
    const t = String(s || "").trim();
    // quita ```json ... ``` o ``` ... ```
    if (t.startsWith("```")) {
      return t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
    }
    return t;
  };

  const extractFirstJsonObject = (s) => {
    const t = String(s || "");
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return t.slice(start, end + 1);
    return null;
  };

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
              "Eres un optimizador de prompts para un generador de imágenes y video. Devuelves prompts mejorados en inglés, más descriptivos, manteniendo la idea original. No agregues contenido sexual explícito ni violento. No agregues explicación.",
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

    const json = await completionRes.json().catch(() => null);
    if (!completionRes.ok || !json) {
      console.error("Respuesta OpenAI:", json);
      res.status(500).json({
        ok: false,
        error: json?.error?.message || "Error desde OpenAI",
      });
      return;
    }

    let raw = json.choices?.[0]?.message?.content?.trim() || "";

    // defaults NO vacíos (para que SIEMPRE se vea algo)
    let optimizedPrompt = String(prompt).trim();
    let optimizedNegative = String(neg || "").trim();

    // limpiar fences
    raw = stripCodeFences(raw);

    // parse robusto
    try {
      let parsed = null;

      // 1) intento directo
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 2) intento extrayendo el primer {...}
        const piece = extractFirstJsonObject(raw);
        if (piece) parsed = JSON.parse(piece);
      }

      if (parsed && typeof parsed === "object") {
        if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
          optimizedPrompt = parsed.prompt.trim();
        } else if (typeof parsed.prompt === "string") {
          // si viene vacío, no lo aceptamos
        }

        if (typeof parsed.negative === "string") {
          optimizedNegative = parsed.negative.trim();
        }
      } else {
        // si no hubo JSON válido, usa texto como prompt optimizado (pero no vacío)
        if (raw && raw.trim()) optimizedPrompt = raw.trim();
      }
    } catch (_) {
      // fallback final: deja prompt original (ya está seteado arriba)
      if (raw && raw.trim()) optimizedPrompt = raw.trim();
    }

    // seguridad extra: nunca devolver vacío
    if (!optimizedPrompt || !optimizedPrompt.trim()) optimizedPrompt = String(prompt).trim();
    if (optimizedNegative == null) optimizedNegative = String(neg || "").trim();

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
