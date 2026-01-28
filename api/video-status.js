import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;

const VIDEO_BUCKET = process.env.VIDEO_BUCKET || "videos"; // tu bucket
const VIDEO_BUCKET_PUBLIC =
  process.env.VIDEO_BUCKET_PUBLIC === "true" || true;

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function getPublicUrl(supabase, bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return json(res, 405, { ok: false, error: "Method not allowed" });
    }

    const jobId = req.query.job_id || req.query.jobId;
    if (!jobId) return json(res, 400, { ok: false, error: "Missing job_id" });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { ok: false, error: "Missing Supabase env vars" });
    }
    if (!RUNPOD_API_KEY) {
      return json(res, 500, { ok: false, error: "Missing RunPod API key" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) buscar job
    const { data: job, error: jobErr } = await supabase
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobErr || !job) {
      return json(res, 404, { ok: false, error: "video_jobs row not found", detail: jobErr?.message });
    }

    const runpodId = job.runpod_job_id || job.runpod_id || job.request_id;
    if (!runpodId) {
      return json(res, 400, { ok: false, error: "Job missing runpod_job_id" });
    }

    // si ya está DONE y tiene URL, devolver rápido
    if ((job.status === "DONE" || job.status === "COMPLETED") && job.video_url) {
      return json(res, 200, { ok: true, status: "DONE", job_id: jobId, video_url: job.video_url });
    }

    // 2) pedir status a runpod
    const statusResp = await fetch(`https://api.runpod.ai/v2/${process.env.RUNPOD_ENDPOINT_ID || ""}/status/${runpodId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const statusJson = await statusResp.json().catch(() => null);
    if (!statusResp.ok) {
      return json(res, 200, {
        ok: false,
        status: "POLL_ERROR",
        runpod_status: null,
        error: "RunPod status request failed",
        detail: statusJson,
      });
    }

    const runStatus = statusJson?.status || "UNKNOWN";

    // 3) si aún no completó
    if (runStatus !== "COMPLETED") {
      // guardar estado parcial
      await supabase
        .from("video_jobs")
        .update({ status: runStatus })
        .eq("id", jobId);

      return json(res, 200, {
        ok: true,
        status: runStatus,
        job_id: jobId,
      });
    }

    // 4) COMPLETED: obtener base64 del video
    const out = statusJson?.output || {};
    const b64 = out.video_b64 || out.video || out.result || null; // soporta llaves comunes
    const mime = out.video_mime || "video/mp4";

    if (!b64) {
      // está completed pero no trae video: guardo fail
      await supabase
        .from("video_jobs")
        .update({ status: "FAILED", error: "COMPLETED but missing video_b64" })
        .eq("id", jobId);

      return json(res, 200, {
        ok: false,
        status: "FAILED",
        job_id: jobId,
        error: "RunPod completed but no video payload",
      });
    }

    // limpiar data url si viniera así
    const pureB64 = String(b64).includes(",") ? String(b64).split(",").pop() : String(b64);
    const buffer = Buffer.from(pureB64, "base64");

    const userId = job.user_id || "anon";
    const filename = `video_${jobId}.mp4`;
    const path = `${userId}/${filename}`;

    // 5) subir a Supabase Storage
    const { error: upErr } = await supabase.storage
      .from(VIDEO_BUCKET)
      .upload(path, buffer, {
        contentType: mime,
        upsert: true,
      });

    if (upErr) {
      await supabase
        .from("video_jobs")
        .update({ status: "FAILED", error: `upload_failed: ${upErr.message}` })
        .eq("id", jobId);

      return json(res, 200, {
        ok: false,
        status: "FAILED",
        job_id: jobId,
        error: "Supabase upload failed",
        detail: upErr.message,
      });
    }

    // 6) url pública
    const publicUrl = getPublicUrl(supabase, VIDEO_BUCKET, path);

    // 7) actualizar tabla
    await supabase
      .from("video_jobs")
      .update({
        status: "DONE",
        video_url: publicUrl,
        storage_bucket: VIDEO_BUCKET,
        storage_path: path,
      })
      .eq("id", jobId);

    return json(res, 200, {
      ok: true,
      status: "DONE",
      job_id: jobId,
      video_url: publicUrl,
      storage: { bucket: VIDEO_BUCKET, path },
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: "server_error", detail: String(e?.message || e) });
  }
}