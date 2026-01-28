// /api/video-status.js
// ============================================================
// - Consulta estado del job en Supabase
// - Consulta RunPod SERVERLESS con endpoint correcto
// - Si COMPLETED: guarda video y devuelve video_url
// - Si FAILED: marca ERROR y refund (pero el refund NUNCA rompe la respuesta)
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

async function safeJson(res) {
  const txt = await res.text();
  try {
    return { json: JSON.parse(txt), txt };
  } catch {
    return { json: null, txt };
  }
}

// ✅ Serverless status correcto: /v2/{endpointId}/status/{requestId}
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

// ✅ Extrae video de muchas variantes
function extractVideo(rpJson) {
  // serverless normalmente trae: { status, output, delayTime, executionTime, ... }
  const out =
    rpJson?.output ||
    rpJson?.result?.output ||
    rpJson?.data?.output ||
    {};

  // Caso: output puede ser string base64 directo (algunos workers)
  if (typeof out === "string" && out.length > 50) {
    return { videoB64: out, videoUrl: null };
  }

  const videoB64 =
    out?.video_base64 ||
    out?.video ||
    out?.mp4_base64 ||
    rpJson?.output?.video_base64 ||
    rpJson?.output?.video ||
    null;

  const videoUrl =
    out?.video_url ||
    out?.url ||
    out?.result_url ||
    rpJson?.output?.video_url ||
    null;

  return { videoB64, videoUrl };
}

// ✅ Refund idempotente: SOLO si hay billing guardado
async function refundJadesOnce(sb, job, user_id) {
  const billedAmount = Number(job?.payload?.billing?.billed_amount || 0);
  if (!billedAmount || billedAmount <= 0) return { refunded: false, refund_amount: 0 };

  const alreadyRefunded = Boolean(job?.payload?.refund?.refunded_at);
  if (alreadyRefunded) return { refunded: true, refund_amount: billedAmount };

  // RPC add_jades (tu función debe existir)
  const { data, error } = await sb.rpc("add_jades", {
    p_user_id: user_id,
    p_amount: billedAmount,
    p_reason: `refund_video_job:${job.job_id}`,
  });

  if (error) throw new Error(error.message || "No se pudo reembolsar jades.");

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

  return { refunded: true, refund_amount: billedAmount, rpc_ok: data === true };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });

    const user_id = auth.user.id;
    const job_id = req.query.job_id;
    if (!job_id) return res.status(400).json({ ok: false, error: "Falta job_id" });

    const sb = sbAdmin();

    const { data: job, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", job_id)
      .eq("user_id", user_id)
      .single();

    if (error || !job) return res.status(404).json({ ok: false, error: "Job no encontrado" });

    // Si ya está DONE
    if (job.status === "DONE" && job.video_url) {
      return res.status(200).json({ ok: true, status: "DONE", video_url: job.video_url });
    }

    if (!job.provider_request_id) {
      return res.status(200).json({ ok: true, status: job.status || "PENDING" });
    }

    const rpJson = await runpodServerlessStatus({
      endpointId: VIDEO_RUNPOD_ENDPOINT_ID,
      requestId: job.provider_request_id,
    });

    const rpStatus = rpJson?.status || "UNKNOWN";

    // Running
    if (["IN_QUEUE", "IN_PROGRESS", "RUNNING", "QUEUED"].includes(rpStatus)) {
      return res.status(200).json({ ok: true, status: rpStatus });
    }

    // ✅ COMPLETED => guardar video sí o sí
    if (rpStatus === "COMPLETED") {
      const { videoB64, videoUrl } = extractVideo(rpJson);

      let finalUrl = null;
      if (videoUrl) finalUrl = videoUrl;
      else if (videoB64) finalUrl = videoB64.startsWith("data:") ? videoB64 : `data:video/mp4;base64,${videoB64}`;

      if (!finalUrl) {
        // No rompas: guarda estado para debug
        await sb
          .from(VIDEO_JOBS_TABLE)
          .update({
            status: "ERROR",
            error: "COMPLETED pero sin video_url/base64",
            updated_at: new Date().toISOString(),
          })
          .eq("job_id", job_id);

        return res.status(200).json({ ok: false, status: "ERROR", error: "COMPLETED pero sin video en output" });
      }

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "DONE",
          video_url: finalUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.status(200).json({ ok: true, status: "DONE", video_url: finalUrl });
    }

    // FAILED => refund, pero NO rompas aunque refund falle
    if (rpStatus === "FAILED") {
      let refundInfo = { refunded: false, refund_amount: 0 };

      try {
        refundInfo = await refundJadesOnce(sb, job, user_id);
      } catch (e) {
        refundInfo = { refunded: false, refund_amount: 0, refund_error: e?.message || String(e) };
      }

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "ERROR",
          error: rpJson?.error || rpJson?.message || "RunPod failed",
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      // ✅ status siempre responde (nunca 500 por refund)
      return res.status(200).json({
        ok: false,
        status: "ERROR",
        error: rpJson?.error || rpJson?.message || "RunPod failed",
        ...refundInfo,
      });
    }

    return res.status(200).json({ ok: true, status: rpStatus });
  } catch (e) {
    console.error("[video-status] ERROR:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}