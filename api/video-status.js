// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// Bucket
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || "videos"; // ✅ tu bucket real
const VIDEO_BUCKET_PUBLIC =
  String(process.env.VIDEO_BUCKET_PUBLIC || "true").toLowerCase() === "true";

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

  const mime = out?.video_mime || out?.mime || "video/mp4";

  return { videoB64, videoUrl, mime };
}

function b64ToBuffer(b64) {
  const clean = b64.startsWith("data:") ? b64.split(",")[1] : b64;
  return Buffer.from(clean, "base64");
}

async function uploadVideoToSupabase(sb, { user_id, job_id, videoB64, mime }) {
  const bytes = b64ToBuffer(videoB64);

  // path: user/{user_id}/{job_id}.mp4
  const ext = mime.includes("webm") ? "webm" : "mp4";
  const path = `user/${user_id}/${job_id}.${ext}`;

  // upsert para poder reintentar
  const { error: upErr } = await sb.storage
    .from(VIDEO_BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      upsert: true,
    });

  if (upErr) throw new Error(`Upload a Storage falló: ${upErr.message}`);

  if (VIDEO_BUCKET_PUBLIC) {
    const { data } = sb.storage.from(VIDEO_BUCKET).getPublicUrl(path);
    const publicUrl = data?.publicUrl;
    if (!publicUrl) throw new Error("No se pudo obtener publicUrl del video.");
    return publicUrl;
  }

  // si bucket privado: signed url (1 día)
  const { data: signed, error: sErr } = await sb.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24);

  if (sErr) throw new Error(`Signed URL falló: ${sErr.message}`);
  return signed?.signedUrl;
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
    if (!job_id) return res.status(400).json({ ok: false, error: "Falta job_id" });

    const sb = sbAdmin();

    const { data: job, error } = await sb
      .from(VIDEO_JOBS_TABLE)
      .select("*")
      .eq("job_id", job_id)
      .eq("user_id", user_id)
      .single();

    if (error || !job) return res.status(404).json({ ok: false, error: "Job no encontrado" });

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

    if (["IN_QUEUE", "IN_PROGRESS", "RUNNING", "QUEUED"].includes(rpStatus)) {
      return res.status(200).json({ ok: true, status: rpStatus });
    }

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

    if (rpStatus === "COMPLETED") {
      const { videoB64, videoUrl, mime } = extractVideoFromOutput(rpJson);

      let finalUrl = null;

      // Si el worker devolvió URL ya lista, úsala
      if (videoUrl) {
        finalUrl = videoUrl;
      } else if (videoB64) {
        // ✅ Subir a Supabase y sacar URL final
        finalUrl = await uploadVideoToSupabase(sb, { user_id, job_id, videoB64, mime });
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

      return res.status(200).json({ ok: true, status: "DONE", video_url: finalUrl });
    }

    return res.status(200).json({ ok: true, status: rpStatus });
  } catch (e) {
    console.error("[video-status] ERROR:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}