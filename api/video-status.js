// api/video-status.js
export const runtime = "nodejs";

// ---------------------------------------------------------
// Video Status (polling)
// - Requiere job_id
// - Lee job de Supabase
// - Si no tiene provider_request_id -> devuelve estado local
// - Si tiene provider_request_id -> consulta RunPod /status/{id}
// - Actualiza video_jobs: progress, provider_status, COMPLETED/FAILED, result_url, error
// ---------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

async function requireUser(req, supabaseAdmin) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { ok: false, status: 401, error: "Missing Bearer token" };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) return { ok: false, status: 401, error: "Invalid token" };
  return { ok: true, user: data.user };
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function nowISO() {
  return new Date().toISOString();
}

// RunPod serverless status:
// GET https://api.runpod.ai/v2/{ENDPOINT_ID}/status/{REQUEST_ID}
async function runpodStatus({ endpointId, apiKey, requestId }) {
  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;
  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(data?.error || data?.message || `RunPod /status failed (${r.status})`);
  }
  return data;
}

// Intenta extraer un URL final del output del worker (ajusta si tu worker devuelve otra clave)
function extractResultUrl(runpodData) {
  // Ejemplos comunes:
  // data.output.video_url
  // data.output.url
  // data.output.result_url
  // data.output.s3_url
  const out = runpodData?.output || null;
  if (!out) return null;

  return (
    out.video_url ||
    out.result_url ||
    out.url ||
    out.s3_url ||
    out.file_url ||
    null
  );
}

// Mapea status RunPod -> progreso aproximado + estados internos
function mapRunpodToInternal(runpodData) {
  const st = (runpodData?.status || "").toUpperCase();

  // RunPod suele usar: IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED
  if (st === "COMPLETED") return { status: "COMPLETED", provider_status: st, progress: 100 };
  if (st === "FAILED" || st === "CANCELLED") return { status: "FAILED", provider_status: st, progress: 0 };

  // En progreso / cola
  if (st === "IN_PROGRESS") return { status: "RUNNING", provider_status: st, progress: 10 };
  if (st === "IN_QUEUE") return { status: "RUNNING", provider_status: st, progress: 3 };

  // Default
  return { status: "RUNNING", provider_status: st || "UNKNOWN", progress: 5 };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { ok: false, error: "Missing Supabase env" });
    }
    if (!RUNPOD_API_KEY || !VIDEO_RUNPOD_ENDPOINT_ID) {
      return json(res, 500, { ok: false, error: "Missing RunPod env" });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const au = await requireUser(req, supabaseAdmin);
    if (!au.ok) return json(res, au.status, { ok: false, error: au.error });
    const user = au.user;

    const job_id = (req.query?.job_id || "").toString();
    if (!job_id) return json(res, 400, { ok: false, error: "Missing job_id" });

    // Lee job
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("video_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) return json(res, 404, { ok: false, error: "Job not found" });

    // Asegura que el usuario solo vea lo suyo (si tu app lo requiere)
    if (job.user_id && job.user_id !== user.id) {
      return json(res, 403, { ok: false, error: "Forbidden" });
    }

    // Si no hay provider_request_id, devuelve estado local (esto ya no debería pasar con A)
    if (!job.provider_request_id) {
      return json(res, 200, {
        ok: true,
        job_id: job.id,
        status: job.status,
        provider_status: job.provider_status,
        progress: job.progress ?? 0,
        result_url: job.result_url,
        error: job.error,
        note: "Job has no provider_request_id yet",
      });
    }

    // Consulta RunPod
    const rp = await runpodStatus({
      endpointId: VIDEO_RUNPOD_ENDPOINT_ID,
      apiKey: RUNPOD_API_KEY,
      requestId: job.provider_request_id,
    });

    const mapped = mapRunpodToInternal(rp);
    const resultUrl = mapped.status === "COMPLETED" ? extractResultUrl(rp) : null;

    // Si el worker devuelve trace/error, guardarlo
    let traceOrErr = null;
    if (mapped.status === "FAILED") {
      traceOrErr = rp?.error || rp?.output?.error || rp?.output?.trace || "RunPod job failed";
    }

    // Actualiza DB
    const updatePatch = {
      status: mapped.status,
      provider_status: mapped.provider_status,
      progress: Math.max(job.progress ?? 0, mapped.progress ?? 0),
      updated_at: nowISO(),
    };

    if (mapped.status === "COMPLETED") {
      updatePatch.progress = 100;
      updatePatch.result_url = resultUrl || job.result_url || null;
      updatePatch.slot_reserved = false;
      updatePatch.slot_token = null;
    }

    if (mapped.status === "FAILED") {
      updatePatch.error = String(traceOrErr);
      updatePatch.slot_reserved = false;
      updatePatch.slot_token = null;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("video_jobs")
      .update(updatePatch)
      .eq("id", job.id)
      .select("*")
      .single();

    if (updErr) throw updErr;

    return json(res, 200, {
      ok: true,
      job_id: updated.id,
      status: updated.status,
      provider_status: updated.provider_status,
      provider_request_id: updated.provider_request_id,
      progress: updated.progress ?? 0,
      result_url: updated.result_url,
      error: updated.error,
      runpod_status: rp?.status || null,
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
