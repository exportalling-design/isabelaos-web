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
    // ✅ Plantillas fijas para “video diffusion”
    const BASE_VIDEO_PROMPT = [
      "ultra cinematic, realistic, high detail, filmic color grade, fine film grain",
      "natural skin texture, realistic pores, realistic lighting and shadows",
      "temporal consistency, stable details across frames",
      "subtle facial micro-expressions, gentle blinking, natural breathing",
      "smooth motion, no jitter, no flicker",
      "camera: slow push-in (or subtle handheld), shallow depth of field, crisp focus on eyes",
      "50mm lens, f/1.8, soft key light + subtle rim light, professional commercial look",
      "vertical framing if requested, otherwise keep the user's framing",
    ].join(", ");

    const BASE_NEGATIVE = [
      // calidad general
      "low quality, blurry, noisy, compression artifacts, watermark, logo, text",
      // look IA
      "cgi, cartoon, anime, plastic skin, waxy skin, over-smoothed, uncanny face",
      // deformaciones
      "bad anatomy, deformed face, distorted hands, extra fingers, duplicated face",
      // problemas temporales de video
      "flicker, jitter, temporal wobble, frame skipping, ghosting, motion artifacts, warping",
    ].join(", ");

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
              [
                "You are a PROMPT OPTIMIZER for VIDEO DIFFUSION (text-to-video / image-to-video).",
                "Goal: maximize realism and cinematic quality, and improve TEMPORAL STABILITY (reduce flicker/jitter).",
                "Return ONLY valid JSON with EXACT keys: {\"prompt\":\"...\",\"negative\":\"...\"}. No markdown, no extra text.",
                "",
                "Rules:",
                "- Keep the user's idea and subject. Do NOT change the meaning.",
                "- Output in ENGLISH.",
                "- Add concrete camera/lighting/motion details when missing (lens, DOF, camera move, micro-movements).",
                "- Add temporal stability constraints (no flicker/jitter/temporal wobble).",
                "- Do NOT add graphic violence. Do NOT add minors.",
                "- Keep prompt concise but strong (1–3 sentences).",
                "- Negative prompt should include temporal artifact blockers.",
              ].join("\n"),
          },
          {
            role: "user",
            content:
              `Original prompt:\n${prompt}\n\n` +
              `Original negative prompt:\n${neg}\n\n` +
              `IMPORTANT: append this VIDEO QUALITY TEMPLATE to the optimized prompt (adapt to context, don't contradict):\n` +
              `${BASE_VIDEO_PROMPT}\n\n` +
              `IMPORTANT: merge this BASE NEGATIVE (avoid duplicates) into the negative prompt:\n` +
              `${BASE_NEGATIVE}\n\n` +
              `Return ONLY JSON:\n{"prompt":"...","negative":"..."}`,
          },
        ],
        // ✅ Menos random para consistencia
        temperature: 0.35,
        max_tokens: 420,
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

    // defaults NO vacíos
    let optimizedPrompt = String(prompt).trim();
    let optimizedNegative = String(neg || "").trim();

    raw = stripCodeFences(raw);

    try {
      let parsed = null;

      try {
        parsed = JSON.parse(raw);
      } catch {
        const piece = extractFirstJsonObject(raw);
        if (piece) parsed = JSON.parse(piece);
      }

      if (parsed && typeof parsed === "object") {
        if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
          optimizedPrompt = parsed.prompt.trim();
        }
        if (typeof parsed.negative === "string") {
          optimizedNegative = parsed.negative.trim();
        }
      } else {
        if (raw && raw.trim()) optimizedPrompt = raw.trim();
      }
    } catch (_) {
      if (raw && raw.trim()) optimizedPrompt = raw.trim();
    }

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