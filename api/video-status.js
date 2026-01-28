// /api/video-status.js
// ============================================================
// - Consulta estado del job en Supabase
// - Si sigue activo → consulta RunPod (SERVERLESS STATUS CORRECTO)
// - Si RunPod terminó → guarda video y marca DONE
// - Si RunPod falla → marca ERROR y ✅ reembolsa jades (si aplica)
// - Devuelve estado limpio al frontend
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
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

// ✅ helper: parse JSON sin romper (evita errores rojos)
async function safeJson(res) {
  const txt = await res.text();
  try {
    return { json: JSON.parse(txt), txt };
  } catch {
    return { json: null, txt };
  }
}

// ✅ serverless status correcto: /v2/{endpointId}/status/{requestId}
async function runpodServerlessStatus({ endpointId, requestId }) {
  if (!endpointId) throw new Error("Falta VIDEO_RUNPOD_ENDPOINT_ID");
  if (!requestId) throw new Error("Falta provider_request_id");

  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;
  const r = await fetch(url, { headers: runpodHeaders() });

  const { json, txt } = await safeJson(r);
  if (!r.ok || !json) {
    throw new Error((json && json.error) || `RunPod status falló (${r.status}): ${txt.slice(0, 180)}`);
  }
  return json;
}

// ✅ refund idempotente (solo 1 vez)
async function refundJadesOnce(sb, { job, user_id }) {
  const billedAmount = Number(job?.payload?.billing?.billed_amount || 0);
  if (!billedAmount || billedAmount <= 0) return { refunded: false, refund_amount: 0 };

  const alreadyRefunded = Boolean(job?.payload?.refund?.refunded_at);
  if (alreadyRefunded) return { refunded: true, refund_amount: billedAmount };

  // RPC: add_jades
  const { data, error } = await sb.rpc("add_jades", {
    p_user_id: user_id,
    p_amount: billedAmount,
    p_reason: `refund_video_job:${job.job_id}`,
  });

  if (error) throw new Error(error.message || "No se pudo reembolsar jades.");

  // marca refund en payload
  const newPayload = {
    ...(job.payload || {}),
    refund: {
      refunded_at: new Date().toISOString(),
      amount: billedAmount,
      reason: "runpod_failed",
    },
  };

  await sb
    .from(VIDEO_JOBS_TABLE)
    .update({ payload: newPayload, updated_at: new Date().toISOString() })
    .eq("job_id", job.job_id);

  return { refunded: true, refund_amount: billedAmount };
}

// ✅ extrae video de diferentes formatos del worker
function extractVideoFromOutput(rpJson) {
  const out = rpJson?.output || rpJson?.result?.output || rpJson?.data?.output || {};
  const videoB64 =
    out?.video_base64 ||
    out?.video ||
    out?.mp4_base64 ||
    rpJson?.output?.video_base64 ||
    null;

  const videoUrl =
    out?.video_url ||
    out?.url ||
    out?.result_url ||
    null;

  return { videoB64, videoUrl, out };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;
    const job_id = req.query.job_id;
    if (!job_id) {
      return res.status(400).json({ ok: false, error: "Falta job_id" });
    }

    const sb = sbAdmin();

    // 1) Leer job
    const { data: job, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", job_id)
      .eq("user_id", user_id)
      .single();

    if (error || !job) {
      return res.status(404).json({ ok: false, error: "Job no encontrado" });
    }

    // 2) Si ya terminó → devolver directo
    if (job.status === "DONE" && job.video_url) {
      return res.status(200).json({
        ok: true,
        status: "DONE",
        video_url: job.video_url,
      });
    }

    // 3) Si no hay request_id aún
    if (!job.provider_request_id) {
      return res.status(200).json({
        ok: true,
        status: job.status || "PENDING",
      });
    }

    // 4) Consultar RunPod (serverless status correcto)
    const rpJson = await runpodServerlessStatus({
      endpointId: VIDEO_RUNPOD_ENDPOINT_ID,
      requestId: job.provider_request_id,
    });

    const rpStatus = rpJson?.status || "UNKNOWN";

    // 5) Si sigue ejecutando
    if (["IN_QUEUE", "IN_PROGRESS", "RUNNING", "QUEUED"].includes(rpStatus)) {
      return res.status(200).json({
        ok: true,
        status: rpStatus,
      });
    }

    // 6) Si FALLÓ → ERROR + refund (si aplica)
    if (rpStatus === "FAILED") {
      let refundInfo = { refunded: false, refund_amount: 0 };

      try {
        refundInfo = await refundJadesOnce(sb, { job, user_id });
      } catch (refundErr) {
        // si el refund falló, no rompemos el status (pero lo reportamos)
        refundInfo = { refunded: false, refund_amount: 0, refund_error: String(refundErr?.message || refundErr) };
      }

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "ERROR",
          error: rpJson?.error || rpJson?.message || "RunPod failed",
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.status(200).json({
        ok: false,
        status: "ERROR",
        error: rpJson?.error || rpJson?.message || "RunPod failed",
        ...refundInfo,
      });
    }

    // 7) Si COMPLETÓ → extraer video
    if (rpStatus === "COMPLETED") {
      const { videoB64, videoUrl } = extractVideoFromOutput(rpJson);

      let finalUrl = null;

      if (videoUrl) {
        finalUrl = videoUrl;
      } else if (videoB64) {
        finalUrl = videoB64.startsWith("data:")
          ? videoB64
          : `data:video/mp4;base64,${videoB64}`;
      } else {
        throw new Error("RunPod terminó pero no devolvió video (ni video_url ni base64).");
      }

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "DONE",
          video_url: finalUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.status(200).json({
        ok: true,
        status: "DONE",
        video_url: finalUrl,
      });
    }

    // fallback
    return res.status(200).json({
      ok: true,
      status: rpStatus,
    });
  } catch (e) {
    console.error("[video-status] ERROR:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}