// api/comercial-storyboard.js
// ─────────────────────────────────────────────────────────────
// Gemini analiza las fotos de referencia y la descripción
// del usuario y genera un storyboard de nivel agencia con:
//   - Escenas (4 para 30s, 7 para 60s)
//   - Prompt de imagen por escena (para Gemini Image)
//   - Prompt de video por escena (para Veo3, sin audio)
//   - Texto de narración en off por escena (para ElevenLabs)
//   - Estructura narrativa de comercial real (problema → solución → CTA)
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
 
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL    = "gemini-2.5-flash";
 
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
 
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
 
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
 
    const description   = String(body?.description || "").trim();
    const duration      = body?.duration === 60 ? 60 : 30;
    const hasAvatar     = !!body?.hasAvatar;
    const referenceImgs = Array.isArray(body?.referenceImages) ? body.referenceImages : [];
    const accent        = String(body?.accent  || "neutro").trim();
    const gender        = String(body?.gender  || "mujer").trim();
 
    if (!description) {
      return res.status(400).json({ ok: false, error: "MISSING_DESCRIPTION" });
    }
 
    const sceneCount = duration === 60 ? 7 : 4;
 
    // Construir partes del mensaje para Gemini
    const parts = [];
 
    // Incluir TODAS las fotos de referencia (hasta 3)
    for (const img of referenceImgs.slice(0, 3)) {
      if (img?.base64 && img?.mimeType) {
        parts.push({
          inline_data: { mime_type: img.mimeType, data: img.base64 }
        });
      }
    }
 
    // Prompt de nivel agencia — estructura narrativa real de comerciales
    const systemPrompt = [
      "Eres el director creativo de una agencia de publicidad de primer nivel en Latinoamérica.",
      "Tu especialidad es crear comerciales que generan ventas reales, no solo 'bonitos'.",
      "Has trabajado con marcas como Claro, Bimbo, Avianca, Corona y Coca-Cola.",
      "",
      "═══════════════════════════════════════",
      "BRIEF DEL CLIENTE:",
      "═══════════════════════════════════════",
      `DESCRIPCIÓN: ${description}`,
      `DURACIÓN: ${duration} segundos (${sceneCount} escenas de 8 segundos cada una)`,
      `VOZ EN OFF: ${gender === "hombre" ? "Narrador masculino" : "Narradora femenina"}, acento ${accent}`,
      `TIENE AVATAR/MODELO: ${hasAvatar ? "SÍ — mantener consistencia del modelo en cada escena" : "NO — usar personas genéricas o el producto como protagonista"}`,
      referenceImgs.length > 0
        ? `REFERENCIAS VISUALES: ${referenceImgs.length} imagen(es) adjunta(s) — úsalas como base visual para todas las escenas`
        : "SIN REFERENCIAS VISUALES — crear desde la descripción",
      "",
      "═══════════════════════════════════════",
      "ESTRUCTURA NARRATIVA OBLIGATORIA:",
      "═══════════════════════════════════════",
      "Los comerciales que venden siguen esta estructura psicológica:",
      "",
      sceneCount === 4
        ? [
            "Escena 1 — GANCHO (2 primeros segundos son todo): imagen impactante que detiene el scroll",
            "Escena 2 — PROBLEMA o DESEO: el espectador se identifica con la situación",
            "Escena 3 — SOLUCIÓN: el producto/servicio entra como la respuesta perfecta",
            "Escena 4 — CTA + RESULTADO: persona feliz usando el producto, llamada a la acción",
          ].join("\n")
        : [
            "Escena 1 — GANCHO: imagen impactante que detiene el scroll",
            "Escena 2 — PROBLEMA o CONTEXTO: situación con la que el espectador se identifica",
            "Escena 3 — AGITACIÓN: el problema en su peor momento",
            "Escena 4 — SOLUCIÓN: el producto aparece como la respuesta",
            "Escena 5 — BENEFICIOS: mostrar 2-3 beneficios clave visualmente",
            "Escena 6 — PRUEBA SOCIAL: resultado real, persona satisfecha",
            "Escena 7 — CTA: llamada a la acción clara y urgente",
          ].join("\n"),
      "",
      "═══════════════════════════════════════",
      "INSTRUCCIONES DE PRODUCCIÓN:",
      "═══════════════════════════════════════",
      "IMAGE PROMPTS (para Gemini Image):",
      "- En INGLÉS, fotorrealistas, extremadamente detallados",
      "- Especificar: iluminación, ángulo, composición, atmósfera",
      "- Nivel de calidad: campaña nacional de TV y redes sociales",
      "- Formato: 9:16 vertical (Reels, TikTok, Stories)",
      "",
      "VIDEO PROMPTS (para Veo3):",
      "- En INGLÉS, describir el movimiento exacto de cámara",
      "- Tipos de movimiento: slow zoom in, crane shot, dolly forward, pan, tilt, handheld",
      "- CRÍTICO: NO incluir audio, diálogos ni música — solo movimiento visual",
      "- El audio lo agrega ElevenLabs como voz en off en postproducción",
      "",
      "NARRACIÓN EN OFF (para ElevenLabs):",
      "- En ESPAÑOL, máximo 18 palabras por escena",
      "- Tono: persuasivo, emocional, natural — NO robótico",
      "- Debe fluir como si fuera una sola narración continua",
      `- Acento y registro: ${accent}, ${gender === "hombre" ? "voz masculina" : "voz femenina"}`,
      "- Usar pausas naturales con comas",
      "",
      `Genera exactamente ${sceneCount} escenas. Responde SOLO en JSON válido, sin markdown:`,
      "{",
      '  "title": "título creativo del comercial (máx 6 palabras)",',
      '  "style": "descripción del estilo visual: paleta de colores, iluminación, mood",',
      '  "target_audience": "público objetivo específico (edad, contexto, necesidad)",',
      '  "narrative_hook": "la idea central que hace memorable este comercial",',
      '  "scenes": [',
      "    {",
      '      "scene_number": 1,',
      '      "duration_seconds": 8,',
      '      "narrative_role": "gancho|problema|solución|beneficio|cta",',
      '      "camera": "tipo de plano en español (primer plano, plano general, plano medio, etc.)",',
      '      "image_prompt": "prompt fotorrealista en inglés para Gemini Image, muy detallado, 50-80 palabras",',
      '      "video_prompt": "prompt en inglés para Veo3 describiendo el movimiento de cámara, 20-40 palabras, sin audio",',
      '      "narration": "texto de narración en off en español, máx 18 palabras, persuasivo",',
      '      "description": "qué pasa en esta escena en 1-2 oraciones"',
      "    }",
      "  ],",
      '  "call_to_action": "texto del CTA final (ej: Visítanos hoy, Llama ahora, Pídelo en línea)",',
      '  "music_mood": "mood musical sugerido para edición (ej: upbeat latino, emocional suave, energético)"',
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
        generationConfig: {
          temperature:      0.75,
          topP:             0.9,
          maxOutputTokens:  6000,
        },
      }),
    });
 
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(`Gemini error ${r.status}: ${txt.slice(0, 300)}`);
    }
 
    const data   = await r.json();
    const rawText = data?.candidates?.[0]?.content?.parts
      ?.map(p => p?.text || "").join("").trim() || "";
 
    // Parsear JSON del storyboard
    let storyboard = null;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      storyboard = JSON.parse(cleaned);
    } catch {
      // Intentar extraer JSON del texto si viene con texto extra
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try { storyboard = JSON.parse(match[0]); } catch {}
      }
    }
 
    if (!storyboard?.scenes?.length) {
      console.error("[comercial-storyboard] rawText:", rawText.slice(0, 500));
      throw new Error("Gemini no generó un storyboard válido.");
    }
 
    console.log(
      `[comercial-storyboard] OK — ${storyboard.scenes.length} escenas` +
      ` para "${storyboard.title}" accent=${accent} gender=${gender}`
    );
 
    return res.status(200).json({
      ok:         true,
      storyboard,
      duration,
      sceneCount: storyboard.scenes.length,
    });
 
  } catch (e) {
    console.error("[comercial-storyboard] ERROR:", e?.message || e);
    return res.status(500).json({
      ok: false, error: e?.message || "Error generando storyboard."
    });
  }
}
