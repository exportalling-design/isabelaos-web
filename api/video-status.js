// api/video-status.js ✅ Poll + auto-dispatch + release slot
export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.RUNPOD_API_KEY ||
  process.env.RP_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY;

const RUNPOD_T2V_ENDPOINT_ID =
  process.env.RP_WAN22_T2V_ENDPOINT ||
  process.env.VIDEO_RUNPOD_ENDPOINT_ID;

const RUNPOD_I2V_ENDPOINT_ID =
  process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.RP_WAN22_I2V_ENDPOINT ||
  process.env.VIDEO_RUNPOD_ENDPOINT_ID;

const VIDEO_MAX_ACTIVE = Number(process.env.VIDEO_MAX_ACTIVE ?? 1);

const VIDEO_BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "videos";
const BUCKET_PUBLIC = String(process.env.SUPABASE_VIDEO_BUCKET_PUBLIC ?? "true").toLowerCase() === "true";

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

function runpodStatusUrl(endpointId, requestId) {
  if (!endpointId || !requestId) return null;
  return `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;
}

async function runpodRun({ endpointId, input }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing RunPod endpoint id");

  const url = `https://api.runpod.ai/v2/${endpointId}/run`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ input }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`RunPod /run failed: ${r.status} ${data?.error || data?.message || JSON.stringify(data)}`);
  return data;
}

function decodeB64ToBuffer(b64) {
  if (!b64) return null;
  let s = String(b64).trim();
  const comma = s.indexOf(",");
  if (s.startsWith("data:") && comma !== -1) s = s.slice(comma + 1);
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

function safeParseJson(s) {
  try {
    if (!s) return null;
    if (typeof s === "object") return s;
    return JSON.parse(String(s));
  } catch {
    return null;
  }
}

function pickEndpointForJob(job) {
  const mode = String(job?.mode || "").toLowerCase();
  return mode === "i2v" ? RUNPOD_I2V_ENDPOINT_ID : RUNPOD_T2V_ENDPOINT_ID;
}

function buildRunInputFromJob(job) {
  const payload = safeParseJson(job.payload) || {};
  const aspect_ratio = String(payload?.aspect_ratio || "").trim();

  const input = {
    mode: String(job.mode || "t2v"),
    job_id: job.id,
    user_id: job.user_id,
    prompt: job.prompt || "",
    negative_prompt: job.negative_prompt || "",
    fps: Number(job.fps ?? 16),
    num_frames: Number(job.num_frames ?? 48),
    steps: Number(job.steps ?? 18),
    guidance_scale: Number(job.guidance_scale ?? 5.0),
    width: Number(job.width ?? 576),
    height: Number(job.height ?? 512),
  };

  const duration_s = payload?.duration_s ?? payload?.seconds ?? null;
  if (duration_s !== null && duration_s !== undefined && duration_s !== "") input.duration_s = duration_s;

  if (aspect_ratio) input.aspect_ratio = aspect_ratio;

  if (String(job.mode).toLowerCase() === "i2v") {
    if (payload?.image_b64) input.image_b64 = String(payload.image_b64);
    if (payload?.image_url) input.image_url = String(payload.image_url).trim();
  }

  return input;
}

async function releaseSlot(admin, jobId) {
  try {
    await admin.rpc("release_video_slot", { p_job_id: jobId });
  } catch (e) {
    // no romper status si falla liberar slot
    console.log("[VIDEO_STATUS] release_video_slot failed:", e?.message || e);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    console.log("[VIDEO_STATUS] VERSION 2026-02-02b");

    const userId = await getUserIdFromRequest(req);
    if (!userId) return json(res, 401, { ok: false, error: "Unauthorized" });

    const jobId = String(req.query?.job_id || "").trim();
    if (!jobId) return json(res, 400, { ok: false, error: "Missing job_id" });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(res, 500, { ok: false, error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    if (!RUNPOD_API_KEY) return json(res, 500, { ok: false, error: "Missing RUNPOD_API_KEY" });
    if (!RUNPOD_T2V_ENDPOINT_ID || !RUNPOD_I2V_ENDPOINT_ID) return json(res, 500, { ok: false, error: "Missing RunPod endpoint env (T2V/I2V)" });

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

    if (job.video_url) return json(res, 200, { ok: true, status: job.status, video_url: job.video_url, job });

    // ✅ auto-dispatch si está QUEUED y no tiene request_id
    if (String(job.status || "").toUpperCase() === "QUEUED" && !job.provider_request_id) {
      const { data: canDispatch, error: lockErr } = await admin.rpc("reserve_video_slot", {
        p_job_id: job.id,
        p_max_active: VIDEO_MAX_ACTIVE,
      });

      if (lockErr || !canDispatch) {
        return json(res, 200, { ok: true, status: "QUEUED", queued: true, job });
      }

      const endpointId = pickEndpointForJob(job);
      const rpInput = buildRunInputFromJob(job);

      try {
        const rp = await runpodRun({ endpointId, input: rpInput });
        const runpodId = rp?.id || rp?.jobId || rp?.request_id || null;

        await admin
          .from("video_jobs")
          .update({
            provider_request_id: runpodId ? String(runpodId) : null,
            provider_status: "submitted",
            status: "IN_PROGRESS",
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, { ok: true, status: "IN_PROGRESS", queued: false, provider_request_id: runpodId });
      } catch (e) {
        await admin
          .from("video_jobs")
          .update({
            status: "QUEUED",
            provider_status: `dispatch_failed: ${String(e?.message || e).slice(0, 180)}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        // ⚠️ liberar slot si dispatch falla
        await releaseSlot(admin, jobId);

        return json(res, 200, { ok: true, status: "QUEUED", queued: true, error: "dispatch_failed_returned_to_queue" });
      }
    }

    if (!job.provider_request_id) {
      return json(res, 200, { ok: true, status: job.status, queued: String(job.status || "").toUpperCase() === "QUEUED", job });
    }

    // ✅ poll RunPod
    const endpointIdForStatus = pickEndpointForJob(job);
    const statusUrl = runpodStatusUrl(endpointIdForStatus, job.provider_request_id);
    if (!statusUrl) return json(res, 500, { ok: false, error: "Could not build RunPod status url" });

    const rpResp = await fetch(statusUrl, { headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` } });
    const rpJson = await rpResp.json().catch(() => ({}));

    if (!rpResp.ok) return json(res, 200, { ok: true, status: job.status, rp: rpJson, job });

    const rpStatus = rpJson?.status || null;
    const output = rpJson?.output || null;

    // ✅ COMPLETED -> video_b64 -> subir a Storage
    if (rpStatus === "COMPLETED") {
      const videoB64 = output?.video_b64 || output?.videoB64 || null;
      const mime = output?.video_mime || output?.mime || output?.content_type || "video/mp4";
      const ext = safeExtFromMime(mime);

      if (!videoB64) {
        await admin.from("video_jobs").update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_error: JSON.stringify(rpJson),
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        await releaseSlot(admin, jobId);
        return json(res, 200, { ok: true, status: "FAILED", error: "COMPLETED but missing video_b64" });
      }

      const buf = decodeB64ToBuffer(videoB64);
      if (!buf || !buf.length) {
        await admin.from("video_jobs").update({
          status: "FAILED",
          provider_status: "FAILED",
          error: "COMPLETED but video_b64 could not be decoded",
          provider_error: JSON.stringify(rpJson),
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        await releaseSlot(admin, jobId);
        return json(res, 200, { ok: true, status: "FAILED", error: "video_b64 decode failed" });
      }

      const filePath = `${userId}/${jobId}.${ext}`;

      const { error: upErr } = await admin.storage.from(VIDEO_BUCKET).upload(filePath, buf, {
        contentType: mime.includes("video/") ? mime : "video/mp4",
        upsert: true,
      });

      if (upErr) {
        await admin.from("video_jobs").update({
          status: "FAILED",
          provider_status: "FAILED",
          error: `Storage upload failed: ${upErr.message}`,
          provider_error: JSON.stringify(rpJson),
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        await releaseSlot(admin, jobId);
        return json(res, 200, { ok: true, status: "FAILED", error: upErr.message });
      }

      let finalUrl = null;
      if (BUCKET_PUBLIC) {
        const { data } = admin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
        finalUrl = data?.publicUrl || null;
      } else {
        const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
        if (!error) finalUrl = data?.signedUrl || null;
      }

      await admin.from("video_jobs").update({
        status: "DONE",
        provider_status: "COMPLETED",
        video_url: finalUrl,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      await releaseSlot(admin, jobId);
      return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl });
    }

    if (rpStatus === "FAILED") {
      await admin.from("video_jobs").update({
        status: "FAILED",
        provider_status: "FAILED",
        provider_error: JSON.stringify(rpJson),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      await releaseSlot(admin, jobId);
      return json(res, 200, { ok: true, status: "FAILED", rp: rpJson });
    }

    // sigue en progreso
    await admin.from("video_jobs").update({
      status: "IN_PROGRESS",
      provider_status: rpStatus || "IN_PROGRESS",
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: rpStatus, job });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}
