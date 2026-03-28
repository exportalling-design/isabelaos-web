// api/comercial-storyboard.js
// ─────────────────────────────────────────────────────────────
// Gemini analiza las fotos de referencia y la descripción
// del usuario y genera un storyboard completo con:
//   - Escenas (4 para 30s, 7 para 60s)
//   - Prompt de imagen por escena
//   - Prompt de video por escena (para Veo3)
//   - Texto de narración por escena (para ElevenLabs)
//   - Instrucción de montaje (si hay producto para montar)
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
 
const GEMINI_API_BASE  = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL     = "gemini-2.5-flash";
 
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
 
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
 
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
 
    const description   = String(body?.description || "").trim();
    const duration      = body?.duration === 60 ? 60 : 30;
    const hasAvatar     = !!body?.hasAvatar;
    const referenceImgs = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
    const accent        = String(body?.accent || "neutro").trim();
 
    if (!description) return res.status(400).json({ ok: false, error: "MISSING_DESCRIPTION" });
 
    const sceneCount = duration === 60 ? 7 : 4;
 
    // Construir partes del mensaje para Gemini
    const parts = [];
 
    // Si hay imágenes de referencia, incluirlas
    for (const img of referenceImgs.slice(0, 3)) {
      if (img?.base64 && img?.mimeType) {
        parts.push({
          inline_data: { mime_type: img.mimeType, data: img.base64 }
        });
      }
    }
 
    const systemPrompt = [
      "Eres un director creativo de comerciales publicitarios latinoamericanos.",
      "Tu trabajo es generar un storyboard profesional para un comercial de video corto.",
      "",
      `DESCRIPCIÓN DEL COMERCIAL: ${description}`,
      `DURACIÓN: ${duration} segundos (${sceneCount} escenas de 8 segundos cada una)`,
      `TIENE AVATAR/MODELO: ${hasAvatar ? "SÍ — usar modelo virtual consistente en cada escena" : "NO — usar personas genéricas o el producto como protagonista"}`,
      `ACENTO DE NARRACIÓN: ${accent}`,
      hasAvatar ? "Las imágenes de referencia muestran el avatar/modelo virtual a usar." : "Las imágenes de referencia muestran el producto o contexto.",
      "",
      "INSTRUCCIONES:",
      "- Cada escena debe ser un 'cambio de cámara' diferente, como en comerciales reales",
      "- Los prompts de video deben ser en INGLÉS, cinematográficos y específicos",
      "- La narración debe ser en ESPAÑOL, natural, persuasiva, con el acento indicado",
      "- El estilo visual debe ser coherente entre escenas (misma paleta, iluminación)",
      "- Si hay producto, debe aparecer claramente en al menos 2 escenas",
      "",
      `Genera exactamente ${sceneCount} escenas. Responde SOLO en JSON válido:`,
      "{",
      '  "title": "título creativo del comercial",',
      '  "style": "descripción del estilo visual general (paleta, iluminación, tono)",',
      '  "target_audience": "público objetivo",',
      '  "scenes": [',
      "    {",
      '      "scene_number": 1,',
      '      "duration_seconds": 8,',
      '      "camera": "tipo de plano (close-up, wide shot, medium shot, etc.)",',
      '      "image_prompt": "prompt detallado en inglés para generar la imagen base de esta escena",',
      '      "video_prompt": "prompt en inglés para Veo3, describiendo el movimiento y acción de 8 segundos",',
      '      "narration": "texto de narración en español para esta escena (máx 20 palabras)",',
      '      "description": "descripción breve de lo que pasa en esta escena"',
      "    }",
      "  ],",
      '  "call_to_action": "texto final del comercial",',
      '  "music_mood": "descripción del mood musical (ej: upbeat latino, emotional, energetic)"',
      "}",
    ].join("\n");
 
    parts.push({ text: systemPrompt });
 
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("MISSING_GEMINI_API_KEY");
 
    const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
 
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 4096 },
      }),
    });
 
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Gemini error ${r.status}: ${txt.slice(0, 200)}`);
    }
 
    const data = await r.json();
    const rawText = data?.candidates?.[0]?.content?.parts
      ?.map(p => p?.text || "").join("").trim() || "";
 
    // Parsear JSON del storyboard
    let storyboard = null;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      storyboard = JSON.parse(cleaned);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try { storyboard = JSON.parse(match[0]); } catch {}
      }
    }
 
    if (!storyboard?.scenes?.length) {
      throw new Error("Gemini no generó un storyboard válido.");
    }
 
    console.log(`[comercial-storyboard] OK — ${storyboard.scenes.length} escenas para "${storyboard.title}"`);
 
    return res.status(200).json({
      ok: true,
      storyboard,
      duration,
      sceneCount: storyboard.scenes.length,
    });
 
  } catch (e) {
    console.error("[comercial-storyboard] ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "Error generando storyboard." });
  }
}
