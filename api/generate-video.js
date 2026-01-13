// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - API de Generación de Video (Vercel Function)
// ============================================================
// ✅ Diseño para 50 usuarios:
// - NO crea pod aquí.
// - NO llama al worker aquí.
// - Solo ENCOLA el job en Supabase (status=PENDING) y retorna job_id.
// - El worker (runner) procesa la cola en RunPod.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// ------------------------------------------------------------
// ENV (Vercel)
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Tablas
const VIDEO_JOBS_TABLE = "video_jobs";

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
const COSTO_JADES_VIDEO = 10;

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  const sb = sbAdmin();
  const log = (...args) => console.log("[GV]", ...args);

  try {
    log("step=ENQUEUE_INICIO");

    // ✅ User real (NO confiar en req.body.userId)
    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }
    const user_id = auth.user.id;

    const {
      // básicos
      prompt = "",
      negativePrompt = "",
      steps = 25,

      // opcionales para el worker
      mode = "t2v",
      height = 704,
      width = 1280,
      num_frames = 121,
      fps = 24,
      guidance_scale = 5.0,
      image_base64 = null, // si algún día usás i2v

      // (legacy) lo ignoramos a propósito
      userId = null,
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Falta prompt (texto) para generar el video.",
      });
    }

    const { data, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .insert([
        {
          user_id, // ✅ SIEMPRE el real
          status: "PENDING",
          mode,
          prompt,
          negative_prompt: negativePrompt,
          steps: Number(steps) || 25,
          height: Number(height) || 704,
          width: Number(width) || 1280,
          num_frames: Number(num_frames) || 121,
          fps: Number(fps) || 24,
          guidance_scale: Number(guidance_scale) || 5.0,
          image_base64: image_base64 || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      .select("*")
      .single();

    if (error) throw error;

    log("step=ENQUEUE_OK", { id: data?.id, user_id });

    return res.status(200).json({
      ok: true,
      job_id: data.id,
      status: data.status,
      costo_jades: COSTO_JADES_VIDEO,
      mensaje:
        "Tu video quedó en cola. Revisa el estado con /api/video-status?job_id=...",
      // debug opcional (si no quieres, lo quitas)
      user_id,
      ignored_body_userId: userId,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("[GV] fatal:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}