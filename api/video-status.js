// /api/video-status.js
// ============================================================
// - Consulta estado del job en Supabase
// - Consulta RunPod Serverless status: /v2/{endpointId}/status/{requestId}
// - Si COMPLETED → guarda video_url y marca DONE
// - Si FAILED → marca ERROR y reembolsa jades (si aplica, idempotente)
// - SIEMPRE responde JSON válido (evita errores rojos de parseo)
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// ------------------------
// Supabase Admin
// ------------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ------------------------
// RunPod headers
// ------------------------
function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// ------------------------
// Safe JSON (si RunPod/Vercel devuelve texto/html no rompe)
// ------------------------
async function safeJson(res) {
  const txt = await res.text();
  try {
    return { json: JSON.parse(txt), txt };
  } catch {
    return { json: null, txt };
  }
}

// ------------------------
// RunPod Serverless Status correcto
// GET https://api.runpod.ai/v2/{endpointId}/status/{requestId}
// ------------------------
async function runpodServerlessStatus({ endpointId, requestId }) {
  if (!endpointId) throw new Error("Falta VIDEO_RUNPOD_ENDPOINT_ID");
  if (!requestId) throw new Error("Falta provider_request_id");

  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;
  const r = await fetch(url, { headers: runpodHeaders() });

  const { json, txt } = await safeJson(r);

  // Si RunPod responde error en texto/HTML, lo mostramos resumido
  if (!r.ok) {
    const msg = json?.error || json?.message || `RunPod status falló (${r.status}): ${txt.slice(0, 200)}`;
    throw new Error(msg);
  }

  // A veces puede venir vacío si hay incidentes → lo tratamos como error claro
  if (!json) {
    throw new Error(`RunPod status no devolvió JSON (${r.status}): ${txt.slice(0, 200)}`);
  }

  return json;
}

// ------------------------
// Extraer video de varios formatos posibles del worker
// ------------------------
function extractVideoFromOutput(rpJson) {
  const out =
    rpJson?.output ||
    rpJson?.result?.output ||
    rpJson?.data?.output ||
    rpJson?.data ||
    {};

  // posibles nombres
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
    out?.mp4_url ||
    null;

  return { videoB64, videoUrl, out };
}

// ------------------------
// Refund idempotente (solo una vez)
// Requiere RPC public.add_jades (si no existe, NO puede reembolsar)
// ------------------------
async function refundJadesOnce(sb, { job, user_id }) {
  // Lo que tú realmente cobraste (si lo guardas en payload)
  const billedAmount =
    Number(job?.payload?.billing?.billed_amount) ||
    Number(job?.payload?.billed_amount) ||
    0;

  if (!billedAmount || billedAmount <= 0) {
    return { refunded: false, refund_amount: 0 };
  }

  const alreadyRefunded = Boolean(job?.payload?.refund?.refunded_at);
  if (alreadyRefunded) {
    return { refunded: true, refund_amount: billedAmount };
  }

  // Intento RPC
  const { data, error } = await sb.rpc("add_jades", {
    p_user_id: user_id,
    p_amount: billedAmount,
    p_reason: `refund_video_job:${job.job_id}`,
  });

  if (error) {
    // Este es EXACTAMENTE tu error rojo si no existe la función
    throw new Error(error.message || "No se pudo reembolsar jades.");
  }

  // Marca refund en payload (idempotencia)
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

  return { refunded: true, refund_amount: billedAmount, refund_rpc: data ?? true };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    // ✅ Auth
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

    // 2) DONE directo
    if (job.status === "DONE" && job.video_url) {
      return res.status(200).json({
        ok: true,
        status: "DONE",
        video_url: job.video_url,
      });
    }

    // 3) sin requestId todavía
    if (!job.provider_request_id) {
      return res.status(200).json({
        ok: true,
        status: job.status || "PENDING",
      });
    }

    // 4) Consultar RunPod
    const rpJson = await runpodServerlessStatus({
      endpointId: VIDEO_RUNPOD_ENDPOINT_ID,
      requestId: job.provider_request_id,
    });

    // RunPod serverless típicamente responde status con estos valores
    const rpStatus = String(rpJson?.status || "UNKNOWN").toUpperCase();

    // 5) Sigue ejecutando
    if (["IN_QUEUE", "IN_PROGRESS", "RUNNING", "QUEUED"].includes(rpStatus)) {
      return res.status(200).json({ ok: true, status: rpStatus });
    }

    // 6) Falló / cancelado / timeout → ERROR + refund
    if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(rpStatus)) {
      let refundInfo = { refunded: false, refund_amount: 0 };

      try {
        refundInfo = await refundJadesOnce(sb, { job, user_id });
      } catch (refundErr) {
        // IMPORTANTÍSIMO: NO tumbamos el status por culpa del refund
        refundInfo = {
          refunded: false,
          refund_amount: 0,
          refund_error: String(refundErr?.message || refundErr),
        };
      }

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "ERROR",
          error: rpJson?.error || rpJson?.message || `RunPod ${rpStatus}`,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.status(200).json({
        ok: false,
        status: "ERROR",
        error: rpJson?.error || rpJson?.message || `RunPod ${rpStatus}`,
        rp_status: rpStatus,
        ...refundInfo,
      });
    }

    // 7) Completó → guardar video
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
        // Guardamos error claro en DB
        await sb
          .from(VIDEO_JOBS_TABLE)
          .update({
            status: "ERROR",
            error: "RunPod COMPLETED pero no devolvió video_url ni base64",
            updated_at: new Date().toISOString(),
          })
          .eq("job_id", job_id);

        return res.status(200).json({
          ok: false,
          status: "ERROR",
          error: "RunPod terminó pero no devolvió video (ni video_url ni base64).",
        });
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

    // fallback (status raro)
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