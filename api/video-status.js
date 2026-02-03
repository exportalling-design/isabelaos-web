// api/video-status.js ✅ (FULL) con auto-dispatch + polling RunPod + export a Storage

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
  process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_ENDPOINT;

const RUNPOD_I2V_ENDPOINT_ID =
  process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_ENDPOINT;

const VIDEO_MAX_ACTIVE = Number(process.env.VIDEO_MAX_ACTIVE ?? 1);

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
  if (!r.ok) {
    const msg = data?.error || data?.message || JSON.stringify(data);
    throw new Error(`RunPod /run failed: ${r.status} ${msg}`);
  }
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
  if (mode === "i2v") return RUNPOD_I2V_ENDPOINT_ID;
  return RUNPOD_T2V_ENDPOINT_ID;
}

function buildRunInputFromJob(job) {
  const input = {
    mode: job.mode,
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

  const payload = safeParseJson(job.payload);

  const aspect_ratio = String(payload?.aspect_ratio || "").trim();
  if (aspect_ratio) input.aspect_ratio = aspect_ratio;

  const duration_s = payload?.duration_s ?? payload?.seconds ?? null;
  if (duration_s !== null && duration_s !== undefined && duration_s !== "") {
    input.duration_s = duration_s;
  }

  if (String(job.mode).toLowerCase() === "i2v") {
    const image_b64 = payload?.image_b64 ? String(payload.image_b64) : null;
    const image_url = payload?.image_url ? String(payload.image_url).trim() : null;
    if (image_b64) input.image_b64 = image_b64;
    if (image_url) input.image_url = image_url;
  }

  return input;
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
    if (!RUNPOD_API_KEY) {
      return json(res, 500, { ok: false, error: "Missing RUNPOD_API_KEY" });
    }
    if (!RUNPOD_T2V_ENDPOINT_ID || !RUNPOD_I2V_ENDPOINT_ID) {
      return json(res, 500, { ok: false, error: "Missing RunPod endpoint env (T2V/I2V)" });
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

    if (job.video_url && job.video_url !== PENDING_PLACEHOLDER) {
      return json(res, 200, { ok: true, status: job.status, video_url: job.video_url, job });
    }

    // ✅ AUTO-DISPATCH desde cola
    if (String(job.status || "").toUpperCase() === "QUEUED" && !job.provider_request_id) {
      const { data: canDispatch, error: lockErr } = await admin.rpc("reserve_video_slot", {
        p_job_id: job.id,
        p_max_active: VIDEO_MAX_ACTIVE,
      });

      if (lockErr || !canDispatch) {
        await admin
          .from("video_jobs")
          .update({
            provider_status: lockErr
              ? `reserve_slot_error: ${String(lockErr.message || lockErr).slice(0, 180)}`
              : "reserve_slot_no_capacity",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, {
          ok: true,
          status: "QUEUED",
          queued: true,
          queue_message: "Video en cola, estará listo en unos minutos.",
          job,
        });
      }

      const endpointId = pickEndpointForJob(job);
      const rpInput = buildRunInputFromJob(job);

      try {
        await admin
          .from("video_jobs")
          .update({
            provider_status: `dispatching_to_runpod:${String(endpointId || "null")}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        const rp = await runpodRun({ endpointId, input: rpInput });
        const runpodId = rp?.id || rp?.jobId || rp?.request_id || null;

        if (runpodId) {
          await admin
            .from("video_jobs")
            .update({
              provider_request_id: String(runpodId),
              provider_status: "submitted",
              status: "IN_PROGRESS",
              started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        } else {
          await admin
            .from("video_jobs")
            .update({
              provider_status: "submitted_no_request_id",
              status: "IN_PROGRESS",
              started_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        }

        const { data: job2 } = await admin
          .from("video_jobs")
          .select("*")
          .eq("id", jobId)
          .eq("user_id", userId)
          .single();

        return json(res, 200, {
          ok: true,
          status: "IN_PROGRESS",
          queued: false,
          provider_request_id: runpodId,
          job: job2 || job,
        });
      } catch (e) {
        await admin
          .from("video_jobs")
          .update({
            status: "QUEUED",
            provider_status: `dispatch_failed: ${String(e?.message || e).slice(0, 180)}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, {
          ok: true,
          status: "QUEUED",
          queued: true,
          queue_message: "Video en cola, estará listo en unos minutos.",
          error: "dispatch_failed_returned_to_queue",
          job,
        });
      }
    }

    if (!job.provider_request_id) {
      return json(res, 200, {
        ok: true,
        status: job.status,
        queued: String(job.status || "").toUpperCase() === "QUEUED",
        queue_message:
          String(job.status || "").toUpperCase() === "QUEUED"
            ? "Video en cola, estará listo en unos minutos."
            : null,
        job,
      });
    }

    // --- RunPod status polling ---
    const endpointIdForStatus = pickEndpointForJob(job);
    const statusUrl = runpodStatusUrl(endpointIdForStatus, job.provider_request_id);
    if (!statusUrl) return json(res, 500, { ok: false, error: "Could not build RunPod status url" });

    const rpResp = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
    });

    const rpJson = await rpResp.json().catch(() => ({}));

    if (!rpResp.ok) {
      return json(res, 200, { ok: true, status: job.status, rp: rpJson, job });
    }

    const rpStatus = rpJson?.status || null;
    const output = rpJson?.output || null;

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

    const videoB64 = output?.video_b64 || output?.videoB64 || null;
    if (rpStatus === "COMPLETED" && videoB64) {
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

      const filePath = `${userId}/${jobId}.${ext}`;

      const { error: upErr } = await admin.storage.from(VIDEO_BUCKET).upload(filePath, buf, {
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

      let finalUrl = null;

      if (BUCKET_PUBLIC) {
        const { data } = admin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
        finalUrl = data?.publicUrl || null;
      } else {
        const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
        if (!error) finalUrl = data?.signedUrl || null;
      }

      await admin
        .from("video_jobs")
        .update({
          status: "DONE",
          provider_status: "COMPLETED",
          video_url: finalUrl,
          error: finalUrl ? null : "Uploaded but could not generate URL",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl });
    }

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
