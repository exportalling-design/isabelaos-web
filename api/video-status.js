// /api/video-status.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// STORAGE
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || null; // <-- poné el bucket real en Vercel
const VIDEO_BUCKET_PUBLIC = String(process.env.VIDEO_BUCKET_PUBLIC || "true") === "true";
const VIDEO_FALLBACK_DATAURL = String(process.env.VIDEO_FALLBACK_DATAURL || "true") === "true";
const SIGNED_URL_TTL = parseInt(process.env.VIDEO_SIGNED_URL_TTL || String(60 * 60 * 24 * 7), 10);

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
  const mime = out?.video_mime || out?.mime || "video/mp4";

  const videoB64 =
    out?.video_base64 ||
    out?.video ||              // <-- tu caso real
    out?.mp4_base64 ||
    out?.mp4 ||
    null;

  const videoUrl =
    out?.video_url ||
    out?.url ||
    out?.mp4_url ||
    null;

  return { videoB64, videoUrl, mime, out };
}

function stripDataUrl(b64) {
  if (!b64 || typeof b64 !== "string") return null;
  if (!b64.startsWith("data:")) return b64;
  const idx = b64.indexOf("base64,");
  if (idx === -1) return null;
  return b64.slice(idx + "base64,".length);
}

function guessExtFromMime(mime) {
  if (!mime) return "mp4";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime")) return "mov";
  return "mp4";
}

async function uploadVideoToStorage(sb, { user_id, job_id, mime, base64 }) {
  if (!VIDEO_BUCKET) throw new Error("Falta VIDEO_BUCKET (nombre del bucket de Storage).");

  const pureB64 = stripDataUrl(base64);
  if (!pureB64) throw new Error("Base64 inválido.");

  const buf = Buffer.from(pureB64, "base64");
  if (!buf || buf.length < 1000) throw new Error("Video buffer demasiado pequeño (base64 corrupto).");

  const ext = guessExtFromMime(mime);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const storage_path = `users/${user_id}/jobs/${job_id}/${ts}.${ext}`;

  const up = await sb.storage.from(VIDEO_BUCKET).upload(storage_path, buf, {
    contentType: mime || "video/mp4",
    upsert: true,
    cacheControl: "3600",
  });

  if (up.error) throw new Error(`Storage upload falló: ${up.error.message}`);

  let url = null;

  if (VIDEO_BUCKET_PUBLIC) {
    const pub = sb.storage.from(VIDEO_BUCKET).getPublicUrl(storage_path);
    url = pub?.data?.publicUrl || null;
  } else {
    const signed = await sb.storage.from(VIDEO_BUCKET).createSignedUrl(storage_path, SIGNED_URL_TTL);
    if (signed.error) throw new Error(`Signed URL falló: ${signed.error.message}`);
    url = signed?.data?.signedUrl || null;
  }

  if (!url) throw new Error("No se pudo construir URL del video.");

  return { storage_path, url, bytes: buf.length };
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
          payload: { ...(job.payload || {}), last_runpod: rpJson },
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
      const { videoB64, videoUrl, mime, out } = extractVideoFromOutput(rpJson);

      // si ya viene URL directo
      if (videoUrl) {
        await sb.from(VIDEO_JOBS_TABLE).update({
          status: "DONE",
          video_url: videoUrl,
          payload: { ...(job.payload || {}), last_runpod_output: out || null },
          updated_at: new Date().toISOString(),
        }).eq("job_id", job_id);

        return res.status(200).json({ ok: true, status: "DONE", video_url: videoUrl });
      }

      if (!videoB64) {
        await sb.from(VIDEO_JOBS_TABLE).update({
          status: "ERROR",
          error: "COMPLETED pero sin video (ni url ni base64)",
          payload: { ...(job.payload || {}), last_runpod_output: out || null },
          updated_at: new Date().toISOString(),
        }).eq("job_id", job_id);

        return res.status(200).json({ ok: false, status: "ERROR", error: "No vino video en output" });
      }

      // 1) Intentar Storage
      try {
        const uploaded = await uploadVideoToStorage(sb, { user_id, job_id, mime, base64: videoB64 });

        await sb.from(VIDEO_JOBS_TABLE).update({
          status: "DONE",
          video_url: uploaded.url,
          payload: {
            ...(job.payload || {}),
            storage: { bucket: VIDEO_BUCKET, path: uploaded.storage_path, bytes: uploaded.bytes, public: VIDEO_BUCKET_PUBLIC },
            last_runpod_output: out || null,
          },
          updated_at: new Date().toISOString(),
        }).eq("job_id", job_id);

        return res.status(200).json({ ok: true, status: "DONE", video_url: uploaded.url });
      } catch (storageErr) {
        // 2) Fallback: devolver data URL sí o sí
        if (!VIDEO_FALLBACK_DATAURL) throw storageErr;

        const pureB64 = stripDataUrl(videoB64);
        const dataUrl = videoB64.startsWith("data:")
          ? videoB64
          : `data:${mime || "video/mp4"};base64,${pureB64}`;

        await sb.from(VIDEO_JOBS_TABLE).update({
          status: "DONE",
          video_url: dataUrl,
          payload: {
            ...(job.payload || {}),
            storage_error: String(storageErr?.message || storageErr),
            last_runpod_output: out || null,
          },
          updated_at: new Date().toISOString(),
        }).eq("job_id", job_id);

        return res.status(200).json({ ok: true, status: "DONE", video_url: dataUrl, warning: "Guardado como data URL (fallback)" });
      }
    }

    return res.status(200).json({ ok: true, status: rpStatus });
  } catch (e) {
    console.error("[video-status] ERROR:", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}