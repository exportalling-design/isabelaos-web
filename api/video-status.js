import { createClient } from "@supabase/supabase-js";
import { fetchVeoOperation } from "../src/lib/veo.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.RUNPOD_API_KEY ||
  process.env.RP_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY;

const RUNPOD_ENDPOINT_ID =
  process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.RP_WAN22_T2V_ENDPOINT ||
  process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_ENDPOINT ||
  null;

const VIDEO_BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "videos";
const BUCKET_PUBLIC =
  String(process.env.SUPABASE_VIDEO_BUCKET_PUBLIC ?? "true").toLowerCase() === "true";

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
  if (m.includes("webm")) return "webm";
  return "mp4";
}

async function uploadVideoBufferToSupabase({ admin, userId, jobId, buf, mime = "video/mp4" }) {
  const ext = safeExtFromMime(mime);
  const filePath = `${userId}/${jobId}.${ext}`;

  const { error: upErr } = await admin.storage.from(VIDEO_BUCKET).upload(filePath, buf, {
    contentType: mime.includes("video/") ? mime : "video/mp4",
    upsert: true,
  });

  if (upErr) {
    throw new Error(`Storage upload failed: ${upErr.message}`);
  }

  let finalUrl = null;

  if (BUCKET_PUBLIC) {
    const { data } = admin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
    finalUrl = data?.publicUrl || null;
  } else {
    const { data, error } = await admin.storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);
    if (!error) finalUrl = data?.signedUrl || null;
  }

  return { filePath, finalUrl };
}

function getDurationForRefund(job) {
  const payload = job?.payload || {};
  const raw = payload?.duration_s ?? payload?.seconds ?? 8;
  const n = Number(raw);
  return n === 5 ? 5 : 8;
}

function getRefundAmount(job) {
  const provider = String(job?.provider || "").toLowerCase();
  const duration = getDurationForRefund(job);

  if (provider === "google_veo") {
    return duration === 5 ? 12 : 15;
  }

  return duration === 5 ? 11 : 12;
}

async function refundJadesSafe({ admin, job, reason }) {
  try {
    const amount = getRefundAmount(job);
    const ref = `refund:${job.id}:${reason}`;

    const { error } = await admin.rpc("refund_jades", {
      p_user_id: job.user_id,
      p_amount: amount,
      p_reason: reason,
      p_ref: ref,
    });

    if (error) {
      console.error("[video-status] refund_jades failed:", error.message, {
        jobId: job.id,
        amount,
        reason,
      });
    } else {
      console.error("[video-status] refund_jades ok:", {
        jobId: job.id,
        userId: job.user_id,
        amount,
        reason,
      });
    }
  } catch (e) {
    console.error("[video-status] refund_jades exception:", e?.message || e, {
      jobId: job?.id,
      reason,
    });
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function deepFindBase64(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (typeof obj.bytesBase64Encoded === "string" && obj.bytesBase64Encoded.length > 100) {
    return obj.bytesBase64Encoded;
  }

  if (typeof obj.bytesBase64 === "string" && obj.bytesBase64.length > 100) {
    return obj.bytesBase64;
  }

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === "object") {
      const found = deepFindBase64(v);
      if (found) return found;
    }
  }

  return null;
}

function deepFindGcsUri(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (typeof obj.gcsUri === "string" && obj.gcsUri.startsWith("gs://")) {
    return obj.gcsUri;
  }

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === "object") {
      const found = deepFindGcsUri(v);
      if (found) return found;
    }
  }

  return null;
}

function deepFindMimeType(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (typeof obj.mimeType === "string" && obj.mimeType.startsWith("video/")) {
    return obj.mimeType;
  }

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === "object") {
      const found = deepFindMimeType(v);
      if (found) return found;
    }
  }

  return null;
}

function extractVeoVideoPayload(op) {
  const response = op?.response || {};

  const videos = Array.isArray(response?.videos) ? response.videos : [];
  const firstVideo = videos[0] || null;

  const directB64 =
    firstVideo?.bytesBase64Encoded ||
    firstVideo?.video?.bytesBase64Encoded ||
    response?.bytesBase64Encoded ||
    response?.video?.bytesBase64Encoded ||
    deepFindBase64(response) ||
    null;

  const mimeType =
    firstVideo?.mimeType ||
    firstVideo?.video?.mimeType ||
    response?.mimeType ||
    response?.video?.mimeType ||
    deepFindMimeType(response) ||
    "video/mp4";

  const gcsUri =
    firstVideo?.gcsUri ||
    firstVideo?.video?.gcsUri ||
    response?.gcsUri ||
    response?.video?.gcsUri ||
    deepFindGcsUri(response) ||
    null;

  return {
    directB64,
    mimeType,
    gcsUri,
    hasVideosArray: videos.length > 0,
    rawResponse: response,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return json(res, 401, { ok: false, error: "Unauthorized" });

    const jobId = String(req.query?.job_id || "").trim();
    if (!jobId) return json(res, 400, { ok: false, error: "Missing job_id" });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, {
        ok: false,
        error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      });
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

    if (!job.provider_request_id) {
      return json(res, 200, { ok: true, status: job.status, job });
    }

    // ---------------------------------------------------------
    // GOOGLE VEO
    // ---------------------------------------------------------
    if (job.provider === "google_veo") {
      const op = await fetchVeoOperation(job.provider_request_id);
      const done = !!op?.done;
      const opError = op?.error || null;

      console.error("[video-status] VEO fetched", {
        jobId,
        done,
        hasError: !!opError,
        operationName: job.provider_request_id,
      });

      if (opError) {
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            provider_error: safeStringify(opError),
            provider_reply: op,
            error: opError?.message || "Veo operation failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        await refundJadesSafe({
          admin,
          job,
          reason: "i2v_generation_failed",
        });

        return json(res, 200, {
          ok: true,
          status: "FAILED",
          error: opError?.message || "Veo operation failed",
          job,
        });
      }

      if (!done) {
        await admin
          .from("video_jobs")
          .update({
            status: "IN_PROGRESS",
            provider_status: "RUNNING",
            provider_reply: op,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, {
          ok: true,
          status: "IN_PROGRESS",
          rp_status: "RUNNING",
          job: { ...job, provider_reply: op },
        });
      }

      const extracted = extractVeoVideoPayload(op);

      console.error("[video-status] VEO done summary", {
        jobId,
        hasVideosArray: extracted.hasVideosArray,
        hasDirectB64: !!extracted.directB64,
        hasGcsUri: !!extracted.gcsUri,
        mimeType: extracted.mimeType,
      });

      if (extracted.directB64) {
        try {
          const buf = decodeB64ToBuffer(extracted.directB64);

          if (!buf || !buf.length) {
            throw new Error("Veo COMPLETED but returned base64 video could not be decoded");
          }

          const { finalUrl } = await uploadVideoBufferToSupabase({
            admin,
            userId,
            jobId,
            buf,
            mime: extracted.mimeType || "video/mp4",
          });

          await admin
            .from("video_jobs")
            .update({
              status: "DONE",
              provider_status: "COMPLETED",
              video_url: finalUrl,
              provider_reply: op,
              error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);

          return json(res, 200, {
            ok: true,
            status: "DONE",
            video_url: finalUrl,
            job,
          });
        } catch (e) {
          await admin
            .from("video_jobs")
            .update({
              status: "FAILED",
              provider_status: "FAILED",
              error: e?.message || "Veo upload failed",
              provider_error: safeStringify(op),
              provider_reply: op,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);

          await refundJadesSafe({
            admin,
            job,
            reason: "i2v_generation_failed",
          });

          return json(res, 200, {
            ok: true,
            status: "FAILED",
            error: e?.message || "Veo upload failed",
            job,
          });
        }
      }

      if (extracted.gcsUri) {
        await admin
          .from("video_jobs")
          .update({
            status: "DONE",
            provider_status: "COMPLETED",
            result_url: extracted.gcsUri,
            provider_reply: op,
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, {
          ok: true,
          status: "DONE",
          video_url: null,
          gcs_uri: extracted.gcsUri,
          note: "veo_returned_gcs_uri_only",
          job,
        });
      }

      await admin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_reply: op,
          provider_error: safeStringify(op),
          error: "Veo finished but no video payload was found",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      await refundJadesSafe({
        admin,
        job,
        reason: "i2v_generation_failed",
      });

      return json(res, 200, {
        ok: true,
        status: "FAILED",
        error: "Veo finished but no video payload was found",
        debug: {
          hasVideosArray: extracted.hasVideosArray,
          hasDirectB64: !!extracted.directB64,
          hasGcsUri: !!extracted.gcsUri,
          mimeType: extracted.mimeType,
          provider_reply_sample: extracted.rawResponse || null,
        },
        job,
      });
    }

    // ---------------------------------------------------------
    // RUNPOD
    // ---------------------------------------------------------
    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
      return json(res, 500, {
        ok: false,
        error: "Missing RUNPOD_API_KEY or RUNPOD endpoint env",
      });
    }

    const statusUrl = runpodStatusUrl(RUNPOD_ENDPOINT_ID, job.provider_request_id);
    if (!statusUrl) {
      return json(res, 500, { ok: false, error: "Could not build RunPod status url" });
    }

    const rpResp = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
    });

    const rpJson = await rpResp.json().catch(() => ({}));

    if (!rpResp.ok) {
      return json(res, 200, {
        ok: true,
        status: job.status,
        rp: rpJson,
        job,
      });
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
          provider_reply: rpJson,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return json(res, 200, { ok: true, status: "DONE", video_url: directUrl, job });
    }

    const videoB64 = output?.video_b64 || output?.videoB64 || null;
    if (rpStatus === "COMPLETED" && videoB64) {
      const mime = output?.mime || output?.content_type || "video/mp4";
      const buf = decodeB64ToBuffer(videoB64);

      if (!buf || !buf.length) {
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            error: "COMPLETED but video_b64 could not be decoded",
            provider_error: safeStringify(rpJson),
            provider_reply: rpJson,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        await refundJadesSafe({
          admin,
          job,
          reason: "i2v_generation_failed",
        });

        return json(res, 200, {
          ok: true,
          status: "FAILED",
          error: "video_b64 decode failed",
        });
      }

      try {
        const { finalUrl } = await uploadVideoBufferToSupabase({
          admin,
          userId,
          jobId,
          buf,
          mime,
        });

        await admin
          .from("video_jobs")
          .update({
            status: "DONE",
            provider_status: "COMPLETED",
            video_url: finalUrl,
            provider_reply: rpJson,
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        return json(res, 200, {
          ok: true,
          status: "DONE",
          video_url: finalUrl,
          job,
        });
      } catch (e) {
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            error: e?.message || "Storage upload failed",
            provider_error: safeStringify(rpJson),
            provider_reply: rpJson,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        await refundJadesSafe({
          admin,
          job,
          reason: "i2v_generation_failed",
        });

        return json(res, 200, {
          ok: true,
          status: "FAILED",
          error: e?.message || "Storage upload failed",
        });
      }
    }

    if (rpStatus === "FAILED") {
      const workerError =
        output?.error ||
        output?.message ||
        rpJson?.error ||
        rpJson?.message ||
        "RunPod job failed";

      await admin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          error: workerError,
          provider_error: safeStringify(rpJson),
          provider_reply: rpJson,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      await refundJadesSafe({
        admin,
        job,
        reason: "i2v_generation_failed",
      });

      return json(res, 200, {
        ok: true,
        status: "FAILED",
        error: workerError,
        rp: rpJson,
      });
    }

    await admin
      .from("video_jobs")
      .update({
        status: "IN_PROGRESS",
        provider_status: rpStatus || "IN_PROGRESS",
        provider_reply: rpJson,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return json(res, 200, {
      ok: true,
      status: "IN_PROGRESS",
      rp_status: rpStatus,
      job,
    });
  } catch (e) {
    return json(res, 500, {
      ok: false,
      error: "Server error",
      details: String(e?.message || e),
    });
  }  
}
