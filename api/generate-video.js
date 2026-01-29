// api/generate-video.js
export const runtime = "nodejs";

import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const admin = getSupabaseAdmin();

    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "Unauthorized (no user_id)" });

    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    const negative_prompt = String(body.negative_prompt || body.negative || "").trim();

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // ✅ INSERT MINIMO: solo campos "seguros"
    const insertPayload = {
      user_id,
      status: "QUEUED",
      prompt,
      negative_prompt,
      // si estas columnas existen, perfecto; si no existen, QUITALAS:
      provider: "runpod",
      provider_status: "QUEUED",
    };

    const { data: job, error: insertErr } = await admin
      .from("video_jobs")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insertErr || !job?.id) {
      // 🔥 DEVUELVE el error real al frontend (para que no estemos a ciegas)
      return res.status(500).json({
        ok: false,
        error: "video_jobs insert failed",
        message: insertErr?.message || null,
        details: insertErr?.details || null,
        hint: insertErr?.hint || null,
        code: insertErr?.code || null,
        insertPayload,
      });
    }

    // Por ahora solo devolvemos job_id (luego conectamos RunPod cuando insert ya esté OK)
    return res.status(200).json({ ok: true, job_id: job.id, status: "QUEUED" });
  } catch (err) {
    console.error("generate-video fatal:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}