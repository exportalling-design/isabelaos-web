// /api/video-status.js  (SERVERLESS)
// ============================================================
// - Lee job en Supabase (video_jobs) por job_id
// - Si tiene provider_request_id, consulta RunPod Serverless /status/:id
// - Mapea estados a: IN_PROGRESS | DONE | ERROR
// - ✅ PATCH: si RunPod devuelve output.video_b64 -> crea video_url data:video/mp4;base64,...
// - Actualiza la fila en video_jobs con status + video_url + error + updated_at
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;
const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function runpodServerlessStatus({ endpointId, requestId }) {
  if (!endpointId) throw new Error("Falta VIDEO_RUNPOD_ENDPOINT_ID");
  if (!requestId) throw new Error("Falta provider_request_id");

  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;

  const r = await fetch(url, {
    method: "GET",
    headers: runpodHeaders(),
  });

  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(j?.error || `RunPod /status falló (${r.status})`);
  return j;
}

// Normaliza estados RunPod -> estados app
function normalizeRunpodStatus(rp) {
  const s = String(rp?.status || "").toUpperCase();

  // RunPod típicamente: IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED, TIMED_OUT
  if (s === "COMPLETED" || s === "SUCCESS") return "DONE";
  if (s === "FAILED" || s === "ERROR" || s === "CANCELLED" || s === "TIMED_OUT") return "ERROR";

  // cualquier otro lo tratamos como "en progreso"
  return "IN_PROGRESS";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });

    // ✅ auth: el job debe ser del usuario logueado
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const job_id = String(req.query?.job_id || "").trim();
    if (!job_id) return res.status(400).json({ ok: false, error: "Falta job_id" });

    const sb = sbAdmin();

    // 1) leer job
    const { data: job, error: jobErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", job_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (jobErr) throw new Error(jobErr.message);
    if (!job) return res.status(404).json({ ok: false, error: "Job no encontrado" });

    // Si ya terminó y tiene video_url, devolvemos directo
    if ((job.status === "DONE" || job.status === "COMPLETED" || job.status === "SUCCESS") && job.video_url) {
      return res.status(200).json({ ok: true, status: "DONE", video_url: job.video_url, job });
    }

    // Si no tiene requestId aún, devolvemos lo que hay
    const requestId = job.provider_request_id;
    if (!requestId) {
      return res.status(200).json({
        ok: true,
        status: job.status || "IN_PROGRESS",
        video_url: job.video_url || null,
        error: job.error || null,
        job,
      });
    }

    // 2) consultar runpod status
    const rp = await runpodServerlessStatus({ endpointId: VIDEO_RUNPOD_ENDPOINT_ID, requestId });

    const normalized = normalizeRunpodStatus(rp);

    // 3) Si terminó OK: construir video_url
    if (normalized === "DONE") {
      const out = rp?.output || {};

      // 3.1) Si viene URL normal
      let video_url =
        out?.video_url ||
        out?.url ||
        out?.result?.video_url ||
        null;

      // 3.2) ✅ PATCH: si viene base64 del worker
      if (!video_url && out?.video_b64) {
        const mime = out?.video_mime || "video/mp4";
        video_url = `data:${mime};base64,${out.video_b64}`;
      }

      // Si por alguna razón terminó pero no hay nada, marcamos error
      if (!video_url) {
        await sb
          .from(VIDEO_JOBS_TABLE)
          .update({
            status: "ERROR",
            error: "COMPLETED_BUT_NO_VIDEO: El job terminó pero no devolvió video_url/video_b64.",
            updated_at: new Date().toISOString(),
          })
          .eq("job_id", job_id)
          .eq("user_id", user_id);

        return res.status(200).json({
          ok: false,
          status: "ERROR",
          error: "El job terminó pero no devolvió video_url/video_b64.",
          runpod: rp,
        });
      }

      // Guardar DONE + video_url
      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "DONE",
          video_url,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id)
        .eq("user_id", user_id);

      return res.status(200).json({ ok: true, status: "DONE", video_url, runpod: rp });
    }

    // 4) Si falló: guardar error
    if (normalized === "ERROR") {
      const errMsg =
        rp?.error ||
        rp?.output?.error ||
        rp?.output?.message ||
        rp?.message ||
        "RUNPOD_FAILED";

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "ERROR",
          error: String(errMsg),
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id)
        .eq("user_id", user_id);

      return res.status(200).json({ ok: false, status: "ERROR", error: String(errMsg), runpod: rp });
    }

    // 5) Sigue en progreso: actualizar estado (opcional)
    await sb
      .from(VIDEO_JOBS_TABLE)
      .update({
        status: "IN_PROGRESS",
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", job_id)
      .eq("user_id", user_id);

    return res.status(200).json({
      ok: true,
      status: "IN_PROGRESS",
      video_url: job.video_url || null,
      job,
      runpod: rp,
    });
  } catch (e) {
    console.error("[video-status] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}