// /api/video-status.js
// ============================================================
// Lee job en video_jobs
// Consulta RunPod Serverless status
// Si COMPLETED: toma output.video_base64 (como tu captura),
// sube a Supabase Storage y guarda video_url en video_jobs
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || "videos"; // ✅ tu bucket

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}`, "Content-Type": "application/json" };
}

async function safeJson(res) {
  const txt = await res.text();
  try {
    return { json: JSON.parse(txt), txt };
  } catch {
    return { json: null, txt };
  }
}

// ✅ Serverless status correcto
async function runpodServerlessStatus({ endpointId, requestId }) {
  if (!endpointId) throw new Error("Falta VIDEO_RUNPOD_ENDPOINT_ID");
  if (!requestId) throw new Error("Falta provider_request_id");

  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;
  const r = await fetch(url, { headers: runpodHeaders() });
  const { json, txt } = await safeJson(r);

  if (!r.ok || !json) {
    throw new Error((json && json.error) || `RunPod status falló (${r.status}): ${txt.slice(0, 200)}`);
  }
  return json;
}

// ✅ EXACTO como tu captura: output.video_base64 + output.video_mime
function extractCompletedVideo(rpJson) {
  if (!rpJson || rpJson.status !== "COMPLETED") {
    return { ok: false, error: "RunPod no está COMPLETED" };
  }
  const out = rpJson.output || {};
  const videoB64 = out.video_base64;
  const mime = out.video_mime || "video/mp4";
  if (!videoB64 || typeof videoB64 !== "string") {
    return { ok: false, error: "RunPod COMPLETED pero falta output.video_base64" };
  }
  return { ok: true, videoB64, mime };
}

function b64ToBuffer(b64) {
  const clean = b64.startsWith("data:") ? b64.split(",")[1] : b64;
  return Buffer.from(clean, "base64");
}

// ✅ Subir a Storage con SERVICE_ROLE (NO necesita policies)
async function uploadVideoToStorage(sb, { bucket, userId, jobId, videoB64, mime }) {
  const bytes = b64ToBuffer(videoB64);

  // path estable
  const path = `user/${userId}/${jobId}.mp4`;

  const { error: upErr } = await sb.storage.from(bucket).upload(path, bytes, {
    contentType: mime,
    upsert: true,
  });
  if (upErr) throw new Error(`Storage upload falló: ${upErr.message}`);

  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("No se pudo obtener publicUrl del storage");

  return { publicUrl: data.publicUrl, path };
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

    // 1) leer job
    const { data: job, error: readErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", job_id)
      .eq("user_id", user_id)
      .single();

    if (readErr || !job) return res.status(404).json({ ok: false, error: "Job no encontrado" });

    // 2) si ya DONE
    if (job.status === "DONE" && job.video_url) {
      return res.status(200).json({ ok: true, status: "DONE", video_url: job.video_url });
    }

    // 3) si no hay request id todavía
    if (!job.provider_request_id) {
      return res.status(200).json({ ok: true, status: job.status || "PENDING" });
    }

    // 4) consultar RunPod
    const rpJson = await runpodServerlessStatus({
      endpointId: VIDEO_RUNPOD_ENDPOINT_ID,
      requestId: job.provider_request_id,
    });

    const rpStatus = rpJson?.status || "UNKNOWN";

    // 5) sigue corriendo
    if (["IN_QUEUE", "IN_PROGRESS", "RUNNING", "QUEUED"].includes(rpStatus)) {
      return res.status(200).json({ ok: true, status: rpStatus });
    }

    // 6) FALLÓ
    if (rpStatus === "FAILED") {
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
      });
    }

    // 7) COMPLETED -> subir a storage y guardar url
    if (rpStatus === "COMPLETED") {
      const extracted = extractCompletedVideo(rpJson);
      if (!extracted.ok) throw new Error(extracted.error);

      const { publicUrl, path } = await uploadVideoToStorage(sb, {
        bucket: VIDEO_BUCKET,
        userId: user_id,
        jobId: job_id,
        videoB64: extracted.videoB64,
        mime: extracted.mime,
      });

      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "DONE",
          video_url: publicUrl,
          // opcional: guardar path interno
          // provider_output_path: path,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      return res.status(200).json({ ok: true, status: "DONE", video_url: publicUrl });
    }

    // fallback
    return res.status(200).json({ ok: true, status: rpStatus });
  } catch (e) {
    console.error("[video-status] ERROR:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}