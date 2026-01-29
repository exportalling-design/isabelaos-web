// api/video-status.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.RUNPOD_API_KEY ||
  process.env.RP_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY;

const RUNPOD_ENDPOINT_ID =
  process.env.RP_WAN22_T2V_ENDPOINT ||
  process.env.VIDEO_RUNPOD_ENDPOINT_ID;

const VIDEO_BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "videos";
const BUCKET_PUBLIC = String(process.env.SUPABASE_VIDEO_BUCKET_PUBLIC ?? "true").toLowerCase() === "true";

const PENDING_PLACEHOLDER = "[PENDING_EXPORT_FROM_B64]";

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserIdFromRequest(req) {
  const jwt = getBearerToken(req);
  if (!jwt) return null;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) return null;
  return data?.user?.id || null;
}

function runpodStatusUrl(endpointIdOrUrl, requestId) {
  const v = String(endpointIdOrUrl || "").trim();
  if (!v || !requestId) return null;
  if (v.startsWith("http://") || v.startsWith("https://")) {
    const base = v.replace(/\/run\/?$/i, "");
    return `${base}/status/${requestId}`;
  }
  return `https://api.runpod.ai/v2/${v}/status/${requestId}`;
}

function decodeB64ToBuffer(b64) {
  if (!b64) return null;
  let s = String(b64).trim();
  // soporta data URL: data:video/mp4;base64,AAAA...
  const comma = s.indexOf(",");
  if (s.startsWith("data:") && comma !== -1) s = s.slice(comma + 1);
  // limpia espacios / newlines
  s = s.replace(/\s+/g, "");
  try {
    return Buffer.from(s, "base64");
  } catch {
    return null;
  }
}

function safeExtFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  return "mp4";
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return json(res, 401, { ok: false, error: "Unauthorized" });

    const jobId = String(req.query?.job_id || "").trim();
    if (!jobId) return json(res, 400, { ok: false, error: "Missing job_id" });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { ok: false, error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    }
    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
      return json(res, 500, { ok: false, error: "Missing RUNPOD_API_KEY or RUNPOD endpoint env" });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: job, error: jobErr } = await admin
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", userId)
      .single();

    if (jobErr || !job) return json(res, 404, { ok: false, error: "Job not found" });

    // ✅ Si YA hay url final (y NO es placeholder), devolvemos
    if (job.video_url && job.video_url !== PENDING_PLACEHOLDER) {
      return json(res, 200, { ok: true, status: job.status, video_url: job.video_url, job });
    }

    if (!job.provider_request_id) {
      return json(res, 200, { ok: true, status: job.status, job });
    }

    const statusUrl = runpodStatusUrl(RUNPOD_ENDPOINT_ID, job.provider_request_id);
    if (!statusUrl) return json(res, 500, { ok: false, error: "Could not build RunPod status url" });

    const rpResp = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
    });

    const rpJson = await rpResp.json().catch(() => ({}));

    if (!rpResp.ok) {
      // no rompemos: devolvemos el job y lo que venga
      return json(res, 200, { ok: true, status: job.status, rp: rpJson, job });
    }

    const rpStatus = rpJson?.status || null;
    const output = rpJson?.output || null;

    // ✅ 1) Caso: el worker ya da una URL directa
    const directUrl = output?.video_url || output?.videoUrl || null;
    if (rpStatus === "COMPLETED" && directUrl) {
      await admin
        .from("video_jobs")
        .update({
          status: "DONE",
          provider_status: "COMPLETED",
          video_url: String(directUrl),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return json(res, 200, { ok: true, status: "DONE", video_url: directUrl });
    }

    // ✅ 2) Caso: worker devuelve video_b64 (TU CASO ACTUAL)
    const videoB64 = output?.video_b64 || output?.videoB64 || null;
    if (rpStatus === "COMPLETED" && videoB64) {
      // intentamos inferir mimetype si viene
      const mime = output?.mime || output?.content_type || "video/mp4";
      const ext = safeExtFromMime(mime);

      const buf = decodeB64ToBuffer(videoB64);
      if (!buf || !buf.length) {
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            error: "COMPLETED but video_b64 could not be decoded",
            provider_error: JSON.stringify(rpJson),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, { ok: true, status: "FAILED", error: "video_b64 decode failed" });
      }

      // path final
      const filePath = `${userId}/${jobId}.${ext}`;

      // subimos a storage
      const { error: upErr } = await admin.storage
        .from(VIDEO_BUCKET)
        .upload(filePath, buf, {
          contentType: mime.includes("video/") ? mime : "video/mp4",
          upsert: true,
        });

      if (upErr) {
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            error: `Storage upload failed: ${upErr.message}`,
            provider_error: JSON.stringify(rpJson),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, { ok: true, status: "FAILED", error: upErr.message });
      }

      // URL final
      let finalUrl = null;

      if (BUCKET_PUBLIC) {
        const { data } = admin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
        finalUrl = data?.publicUrl || null;
      } else {
        // bucket privado: URL firmada (7 días)
        const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
        if (!error) finalUrl = data?.signedUrl || null;
      }

      if (!finalUrl) {
        // subió pero no pudimos generar url
        await admin
          .from("video_jobs")
          .update({
            status: "DONE",
            provider_status: "COMPLETED",
            video_url: null,
            error: "Uploaded but could not generate URL",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, { ok: true, status: "DONE", video_url: null, note: "uploaded_no_url" });
      }

      await admin
        .from("video_jobs")
        .update({
          status: "DONE",
          provider_status: "COMPLETED",
          video_url: finalUrl,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl });
    }

    // ✅ FAILED
    if (rpStatus === "FAILED") {
      await admin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_error: JSON.stringify(rpJson),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return json(res, 200, { ok: true, status: "FAILED", rp: rpJson });
    }

    // ✅ sigue en progreso
    await admin
      .from("video_jobs")
      .update({
        status: "IN_PROGRESS",
        provider_status: rpStatus || "IN_PROGRESS",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: rpStatus, job });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}