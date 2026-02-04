// /api/video-status.js
export const runtime = "nodejs";

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_VIDEO_ENDPOINT_ID = process.env.RUNPOD_VIDEO_ENDPOINT_ID; // ej: na84z1ykf1anuo

function json(res, code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function rpStatus(requestId) {
  if (!RUNPOD_API_KEY || !RUNPOD_VIDEO_ENDPOINT_ID) return null;

  const url = `https://api.runpod.ai/v2/${RUNPOD_VIDEO_ENDPOINT_ID}/status/${requestId}`;
  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) return { ok: false, http: r.status, raw: j };
  return { ok: true, raw: j };
}

function pickVideoFromRunpod(raw) {
  // RunPod suele devolver { status, output, error, ... }
  const out = raw?.output || raw?.result?.output || null;

  const videoUrl =
    out?.video_url ||
    out?.result_url ||
    out?.url ||
    raw?.output?.video_url ||
    null;

  const b64 =
    out?.video_base64 ||
    out?.video_b64 ||
    out?.b64 ||
    null;

  return { out, videoUrl, b64 };
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");
    if (!jobId) return json(null, 400, { ok: false, error: "missing job_id" });

    const supabase = createClient(SB_URL, SB_SERVICE_ROLE);

    // 1) leer job
    const { data: job, error: e1 } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (e1 || !job) {
      return json(null, 404, { ok: false, error: "job_not_found", detail: e1?.message });
    }

    // Si ya hay result_url, devolver directo
    if (job.result_url) {
      return json(null, 200, {
        ok: true,
        job_id: job.id,
        status: job.status,
        provider_status: job.provider_status,
        progress: job.progress ?? (job.status === "COMPLETED" ? 100 : 0),
        video_url: job.result_url,
        error: job.error || null,
        updated_at: job.updated_at,
      });
    }

    // 2) Si no hay result_url pero hay request id -> preguntar a RunPod
    if (job.provider_request_id) {
      const st = await rpStatus(job.provider_request_id);

      if (st?.ok) {
        const raw = st.raw;
        const rpStat = raw?.status || raw?.state || null; // "COMPLETED", "IN_PROGRESS", etc.
        const { videoUrl, b64 } = pickVideoFromRunpod(raw);

        // Mapear progreso simple
        const progress =
          raw?.output?.progress ??
          raw?.progress ??
          (rpStat === "COMPLETED" ? 100 : job.progress ?? 0);

        // Si ya completó y trae URL -> guardamos
        if ((rpStat === "COMPLETED" || rpStat === "COMPLETED_SUCCESS") && videoUrl) {
          await supabase
            .from("video_jobs")
            .update({
              status: "COMPLETED",
              provider_status: "COMPLETED",
              progress: 100,
              result_url: videoUrl,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          return json(null, 200, {
            ok: true,
            job_id: job.id,
            status: "COMPLETED",
            provider_status: "COMPLETED",
            progress: 100,
            video_url: videoUrl,
            error: null,
            updated_at: new Date().toISOString(),
          });
        }

        // Si completó pero SOLO trae base64, devolvemos data-url (temporal)
        if ((rpStat === "COMPLETED" || rpStat === "COMPLETED_SUCCESS") && b64) {
          const dataUrl = `data:video/mp4;base64,${b64}`;

          await supabase
            .from("video_jobs")
            .update({
              status: "COMPLETED",
              provider_status: "COMPLETED",
              progress: 100,
              // NO guardo el base64 en DB (malo). Solo lo devolvemos para que lo veas ya.
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          return json(null, 200, {
            ok: true,
            job_id: job.id,
            status: "COMPLETED",
            provider_status: "COMPLETED",
            progress: 100,
            video_url: dataUrl,
            warning: "returned_base64_data_url_temporal",
            updated_at: new Date().toISOString(),
          });
        }

        // Si falló en RunPod
        if (rpStat === "FAILED" || rpStat === "ERROR") {
          const errMsg = raw?.error || raw?.output?.error || "runpod_failed";
          await supabase
            .from("video_jobs")
            .update({
              status: "FAILED",
              provider_status: "FAILED",
              error: errMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          return json(null, 200, {
            ok: true,
            job_id: job.id,
            status: "FAILED",
            provider_status: "FAILED",
            progress: 0,
            video_url: null,
            error: errMsg,
          });
        }

        // En progreso / queued
        return json(null, 200, {
          ok: true,
          job_id: job.id,
          status: job.status,
          provider_status: rpStat || job.provider_status,
          progress,
          video_url: null,
          error: null,
          note: "still_processing",
        });
      }
    }

    // Sin provider_request_id o sin RunPod creds
    return json(null, 200, {
      ok: true,
      job_id: job.id,
      status: job.status,
      provider_status: job.provider_status,
      progress: job.progress ?? 0,
      video_url: null,
      error: job.error || null,
      note: "no_result_url_yet",
    });
  } catch (err) {
    return json(null, 500, { ok: false, error: "video_status_exception", detail: String(err) });
  }
}
