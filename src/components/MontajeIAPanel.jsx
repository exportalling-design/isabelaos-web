// api/isabela-montaje-chat.js
// ─────────────────────────────────────────────────────────────
// Chat conversacional con Gemini para el módulo Montaje IA.
// Detecta intención del usuario y propone un plan antes de generar.
// Flujos soportados:
//   A) Solo imagen → edición con Gemini (cartoon, studio, agregar persona, etc.)
//   B) Imagen + fondo → composición profesional (requiere RunPod — pendiente)
// ─────────────────────────────────────────────────────────────
import { vertexFetch, extractTextFromVertexResponse, GOOGLE_PROJECT_ID } from "./_googleVertex.js";
 
const MODEL    = "gemini-2.5-flash";
const LOCATION = "global";
 
function normalizeHistory(chatHistory) {
  if (!Array.isArray(chatHistory)) return [];
  return chatHistory.map((item) => {
    const role = item?.role === "assistant" || item?.role === "model" ? "model" : "user";
    const text = typeof item?.text === "string" ? item.text
      : typeof item?.content === "string" ? item.content
      : typeof item?.message === "string" ? item.message : "";
    if (!text.trim()) return null;
    return { role, parts: [{ text: text.trim() }] };
  }).filter(Boolean);
}
 
function safeParseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    return null;
  }
}
 
function extractReply(obj) {
  if (!obj || typeof obj !== "object") return "";
  const keys = ["reply","respuesta","message","mensaje","greeting","saludo","next_step_instruction"];
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key].trim()) return obj[key].trim();
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = extractReply(value);
      if (nested) return nested;
    }
  }
  const values = Object.values(obj).filter((v) => typeof v === "string" && v.trim());
  return values.join(" ") || "";
}
 
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
 
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const message          = String(body?.message || body?.prompt || "").trim();
    const chatHistory      = body?.chatHistory || [];
    const hasPersonImage   = !!body?.hasPersonImage;
    const hasBackgroundImage = !!body?.hasBackgroundImage;
 
    if (!message) return res.status(400).json({ ok: false, error: "Falta el mensaje." });
 
    // Detectar el tipo de edición que quiere el usuario
    const systemContext = [
      "Eres Isabela, asistente de montaje visual de IsabelaOS Studio.",
      "Tu trabajo es entender qué quiere hacer el usuario con su imagen y proponer un plan claro.",
      "",
      "TIPOS DE EDICIÓN DISPONIBLES:",
      "- gemini_edit: Edición directa con IA (cartoonizar, estilo studio, agregar personas famosas, cambiar fondo con IA, mejorar foto, etc.)",
      "- compose_scene: Montar persona/producto sobre fondo real subido por el usuario (requiere imagen de fondo)",
      "",
      `Estado actual:`,
      `- Imagen principal subida: ${hasPersonImage ? "SÍ" : "NO"}`,
      `- Imagen de fondo subida: ${hasBackgroundImage ? "SÍ" : "NO"}`,
      "",
      "INSTRUCCIONES:",
      "1. Conversa naturalmente para entender la intención.",
      "2. Cuando tengas suficiente info, propón el plan y pregunta si está listo para generar.",
      "3. Si el usuario dice 'sí', 'listo', 'genera', 'hazlo' → marca ready_to_generate: true",
      "4. Siempre responde en JSON válido con esta estructura:",
      "{",
      '  "reply": "tu respuesta conversacional aquí",',
      '  "edit_type": "gemini_edit|compose_scene|unknown",',
      '  "edit_plan": "descripción corta del plan de edición",',
      '  "final_prompt": "prompt en inglés listo para generar",',
      '  "ready_to_generate": false,',
      '  "need_person_image": false,',
      '  "need_background_image": false',
      "}",
    ].join("\n");
 
    const history = normalizeHistory(chatHistory);
 
    // Insertar contexto del sistema al inicio
    const contents = [
      { role: "user",  parts: [{ text: systemContext }] },
      { role: "model", parts: [{ text: '{"reply": "Entendido, estoy listo para ayudarte.", "edit_type": "unknown", "ready_to_generate": false}' }] },
      ...history,
      { role: "user",  parts: [{ text: message }] },
    ];
 
    const data    = await vertexFetch({ model: MODEL, location: LOCATION, projectId: GOOGLE_PROJECT_ID,
      contents, generationConfig: { temperature: 0.35, topP: 0.9, maxOutputTokens: 900 } });
    const rawText = extractTextFromVertexResponse(data);
    const parsed  = safeParseJSON(rawText);
 
    const reply = extractReply(parsed) || (typeof rawText === "string" ? rawText.trim() : "") ||
      "Entendido. ¿Estás listo para generar el montaje?";
 
    return res.status(200).json({
      ok:                    true,
      reply:                 String(reply).replace(/```json|```/g, "").trim(),
      edit_type:             parsed?.edit_type             || "unknown",
      edit_plan:             parsed?.edit_plan             || "",
      final_prompt:          parsed?.final_prompt          || message,
      ready_to_generate:     !!parsed?.ready_to_generate,
      need_person_image:     !!parsed?.need_person_image,
      need_background_image: !!parsed?.need_background_image,
    });
 
  } catch (e) {
    console.error("[isabela-montaje-chat] ERROR:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Error interno." });
  }
}
