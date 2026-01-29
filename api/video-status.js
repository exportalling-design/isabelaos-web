// api/video-status.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT = process.env.VIDEO_RUNPOD_ENDPOINT || process.env.RUNPOD_VIDEO_ENDPOINT || process.env.RUNPOD_ENDPOINT;

function json(res, code, obj) {
  res.status(code).setHeader("Content-Type", "application/json");
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

function buildRunpodStatusUrl(endpointOrUrl, requestId) {
  if (!endpointOrUrl || !requestId) return null;
  const v = String(endpointOrUrl).trim();
  if (v.startsWith("http://") || v.startsWith("https://")) {
    // si te guardaste una URL completa de /run, la convertimos a /status
    // ejemplo: https://api.runpod.ai/v2/<id>/run  ->  https://api.runpod.ai/v2/<id>/status/<req>
    const base = v.replace(/\/run\/?$/i, "");
    return `${base}/status/${requestId}`;
  }
  return `https://api.runpod.ai/v2/${v}/status/${requestId}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return json(res, 401, { ok: false, error: "Unauthorized" });

    const jobId = String(req.query?.job_id || "").trim();
    if (!jobId) return json(res, 400, { ok: false, error: "Missing job_id" });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { ok: false, error: "Missing SUPABASE env" });
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

    // Si ya está listo con URL, devolvemos directo
    if (job.video_url) {
      return json(res, 200, { ok: true, status: job.status, video_url: job.video_url, job });
    }

    // Si no hay request id, aún no se mandó bien
    if (!job.provider_request_id) {
      return json(res, 200, { ok: true, status: job.status, job });
    }

    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT) {
      return json(res, 500, { ok: false, error: "Missing RUNPOD env" });
    }

    const statusUrl = buildRunpodStatusUrl(RUNPOD_ENDPOINT, job.provider_request_id);
    const rpResp = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
    });

    const rpJson = await rpResp.json().catch(() => ({}));

    if (!rpResp.ok) {
      return json(res, 200, { ok: true, status: job.status, provider_status: "STATUS_CHECK_FAILED", rp: rpJson, job });
    }

    // RunPod típico: { status: "COMPLETED", output: {...} }
    const rpStatus = rpJson?.status || null;
    const output = rpJson?.output || null;

    // Ajusta estas keys según tu worker:
    const videoUrl = output?.video_url || output?.videoUrl || null;

    if (rpStatus === "COMPLETED" && videoUrl) {
      await admin
        .from("video_jobs")
        .update({ status: "COMPLETED", provider_status: "COMPLETED", video_url: videoUrl })
        .eq("id", jobId);

      return json(res, 200, { ok: true, status: "COMPLETED", video_url: videoUrl });
    }

    if (rpStatus === "FAILED") {
      await admin
        .from("video_jobs")
        .update({ status: "FAILED", provider_status: "FAILED", provider_error: JSON.stringify(rpJson) })
        .eq("id", jobId);

      return json(res, 200, { ok: true, status: "FAILED", rp: rpJson });
    }

    // En progreso
    await admin
      .from("video_jobs")
      .update({ status: "IN_PROGRESS", provider_status: rpStatus || "IN_PROGRESS" })
      .eq("id", jobId);

    return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: rpStatus, job });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}