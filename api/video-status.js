// =====================================================
// api/video-status.js
// -----------------------------------------------------
// Estado de jobs de video para:
// 1) Google Veo (Express)
// 2) fal.ai WAN 2.6 Flash (Standard)
// 3) RunPod (Studio)
// -----------------------------------------------------
// Qué hace:
// - autentica al usuario por Bearer token
// - busca el job en Supabase
// - si ya hay video_url, la devuelve
// - si es Veo:
//    * consulta la operación
//    * si devuelve gcsUri, descarga el mp4 desde GCS
//    * lo sube a Supabase Storage
//    * guarda video_url final para el frontend
// - si es fal:
//    * consulta status de cola
//    * cuando termina, obtiene resultado
//    * descarga/sube o guarda URL final
// - si es RunPod:
//    * soporta URL directa o base64
// - si algo falla:
//    * marca FAILED
//    * hace refund de jades
// =====================================================

import { createClient } from "@supabase/supabase-js";
import { GoogleAuth } from "google-auth-library";
import { fal } from "@fal-ai/client";
import { fetchVeoOperation } from "../src/lib/veo.js";

// =====================================================
// 1) Variables de entorno
// =====================================================

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

const FAL_KEY = process.env.FAL_KEY || null;

const VIDEO_BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "videos";
const BUCKET_PUBLIC =
  String(process.env.SUPABASE_VIDEO_BUCKET_PUBLIC ?? "true").toLowerCase() === "true";

const PENDING_PLACEHOLDER = "[PENDING_EXPORT_FROM_B64]";

if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

// =====================================================
// 2) Helpers básicos
// =====================================================

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// =====================================================
// 3) Auth del usuario desde JWT de Supabase
// =====================================================

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

// =====================================================
// 4) Helpers RunPod
// =====================================================

function runpodStatusUrl(endpointIdOrUrl, requestId) {
  const v = String(endpointIdOrUrl || "").trim();
  if (!v || !requestId) return null;

  if (v.startsWith("http://") || v.startsWith("https://")) {
    const base = v.replace(/\/run\/?$/i, "");
    return `${base}/status/${requestId}`;
  }

  return `https://api.runpod.ai/v2/${v}/status/${requestId}`;
}

// =====================================================
// 5) Helpers base64 / archivos
// =====================================================

function decodeB64ToBuffer(b64) {
  if (!b64) return null;

  let s = String(b64).trim();
  const comma = s.indexOf(",");

  if (s.startsWith("data:") && comma !== -1) {
    s = s.slice(comma + 1);
  }

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

async function fetchUrlToBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Failed to fetch remote video: ${resp.status} ${txt}`);
  }
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

// =====================================================
// 6) Subida de video final a Supabase Storage
// =====================================================

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

// =====================================================
// 7) Refund de jades
// =====================================================

function getRefundAmount(job) {
  const provider = String(job?.provider || "").toLowerCase();
  const payload = job?.payload || {};
  const mode = String(payload?.generation_mode || "").toLowerCase();
  const duration = Number(payload?.resolved_duration_s ?? payload?.duration_s ?? payload?.seconds ?? 8);
  const includeAudio = !!payload?.include_audio;

  if (provider === "google_veo" || mode === "express") {
    return 18;
  }

  if (provider === "fal_wan_flash" || mode === "standard") {
    let amount = 17;
    if (duration === 15) amount = 24;
    else if (duration === 10) amount = 17;
    else if (duration === 5) amount = 12;

    if (includeAudio) amount += 4;
    return amount;
  }

  return 11; // studio / runpod
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

// =====================================================
// 8) Google auth helpers para leer desde GCS
// =====================================================

function getGoogleCredentials() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawJson) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  }

  try {
    return JSON.parse(rawJson);
  } catch (e) {
    throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e?.message || "parse failed"}`);
  }
}

async function getGoogleAccessToken() {
  const credentials = getGoogleCredentials();

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token?.token || token;
}

// =====================================================
// 9) Helpers GCS
// =====================================================

function parseGsUri(gsUri) {
  const raw = String(gsUri || "").trim();
  if (!raw.startsWith("gs://")) return null;

  const without = raw.slice(5);
  const slash = without.indexOf("/");

  if (slash === -1) {
    return {
      bucket: without,
      objectPath: "",
    };
  }

  return {
    bucket: without.slice(0, slash),
    objectPath: without.slice(slash + 1),
  };
}

async function downloadGcsObjectToBuffer(gsUri) {
  const parsed = parseGsUri(gsUri);
  if (!parsed?.bucket || !parsed?.objectPath) {
    throw new Error(`Invalid gcsUri: ${gsUri}`);
  }

  const accessToken = await getGoogleAccessToken();

  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(parsed.bucket)}` +
    `/o/${encodeURIComponent(parsed.objectPath)}?alt=media`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Failed to download GCS object: ${resp.status} ${txt}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// =====================================================
// 10) Extractores profundos para Veo
// =====================================================

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

// =====================================================
// 11) Extraer payload de Veo
// =====================================================

function extractVeoVideoPayload(op) {
  const response = op?.response || {};
  const videos = Array.isArray(response?.videos) ? response.videos : [];
  const firstVideo = videos[0] || null;

  const directB64 =
    firstVideo?.bytesBase64Encoded ||
    firstVideo?.bytesBase64 ||
    firstVideo?.video?.bytesBase64Encoded ||
    firstVideo?.video?.bytesBase64 ||
    response?.bytesBase64Encoded ||
    response?.bytesBase64 ||
    response?.video?.bytesBase64Encoded ||
    response?.video?.bytesBase64 ||
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

// =====================================================
// 12) Helpers fal
// =====================================================

function normalizeFalStatus(status) {
  const s = String(status || "").toUpperCase();

  if (["COMPLETED", "DONE", "SUCCESS", "FINISHED"].includes(s)) return "COMPLETED";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(s)) return "FAILED";
  if (["IN_PROGRESS", "IN_QUEUE", "QUEUED", "RUNNING"].includes(s)) return "IN_PROGRESS";

  return s || "IN_PROGRESS";
}

function extractFalVideoInfo(result) {
  const root = result?.data || result || {};

  const possibleUrl =
    root?.video?.url ||
    root?.video_url ||
    root?.videoUrl ||
    root?.output?.video?.url ||
    root?.output?.video_url ||
    root?.output?.videoUrl ||
    null;

  const possibleMime =
    root?.video?.content_type ||
    root?.video?.mime_type ||
    root?.mime ||
    root?.mime_type ||
    "video/mp4";

  const possibleB64 =
    root?.video_b64 ||
    root?.videoBase64 ||
    root?.output?.video_b64 ||
    root?.output?.videoBase64 ||
    null;

  return {
    url: possibleUrl ? String(possibleUrl) : null,
    mime: possibleMime ? String(possibleMime) : "video/mp4",
    b64: possibleB64 ? String(possibleB64) : null,
    raw: root,
  };
}

// =====================================================
// 13) Handler principal
// =====================================================

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    // -------------------------------------------------
    // 13.1) Auth y validaciones
    // -------------------------------------------------
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

    // -------------------------------------------------
    // 13.2) Buscar job en video_jobs
    // -------------------------------------------------
    const { data: job, error: jobErr } = await admin
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", userId)
      .single();

    if (jobErr || !job) {
      return json(res, 404, { ok: false, error: "Job not found" });
    }

    // -------------------------------------------------
    // 13.3) Si ya hay video_url final, devolverlo
    // -------------------------------------------------
    if (job.video_url && job.video_url !== PENDING_PLACEHOLDER) {
      return json(res, 200, {
        ok: true,
        status: job.status,
        video_url: job.video_url,
        job,
      });
    }

    // -------------------------------------------------
    // 13.4) Si aún no hay provider_request_id
    // -------------------------------------------------
    if (!job.provider_request_id) {
      return json(res, 200, { ok: true, status: job.status, job });
    }

    // =================================================
    // 14) GOOGLE VEO
    // =================================================
    if (job.provider === "google_veo") {
      const op = await fetchVeoOperation(job.provider_request_id);

      console.error("[video-status] FULL VEO OP:", JSON.stringify(op, null, 2));

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
        try {
          const gcsBuffer = await downloadGcsObjectToBuffer(extracted.gcsUri);

          if (!gcsBuffer || !gcsBuffer.length) {
            throw new Error("GCS object downloaded empty buffer");
          }

          const { finalUrl } = await uploadVideoBufferToSupabase({
            admin,
            userId,
            jobId,
            buf: gcsBuffer,
            mime: extracted.mimeType || "video/mp4",
          });

          await admin
            .from("video_jobs")
            .update({
              status: "DONE",
              provider_status: "COMPLETED",
              video_url: finalUrl,
              result_url: extracted.gcsUri,
              provider_reply: op,
              error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);

          return json(res, 200, {
            ok: true,
            status: "DONE",
            video_url: finalUrl,
            gcs_uri: extracted.gcsUri,
            job,
          });
        } catch (e) {
          await admin
            .from("video_jobs")
            .update({
              status: "FAILED",
              provider_status: "FAILED",
              provider_reply: op,
              provider_error: safeStringify(op),
              error: e?.message || "Failed to download/upload GCS video",
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
            error: e?.message || "Failed to download/upload GCS video",
            job,
          });
        }
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

    // =================================================
    // 15) FAL WAN FLASH
    // =================================================
    if (job.provider === "fal_wan_flash") {
      if (!FAL_KEY) {
        return json(res, 500, {
          ok: false,
          error: "Missing FAL_KEY",
        });
      }

      try {
        fal.config({ credentials: FAL_KEY });

        const queueStatus = await fal.queue.status("wan/v2.6/image-to-video/flash", {
          requestId: String(job.provider_request_id),
          logs: true,
        });

        const normalizedStatus = normalizeFalStatus(
          queueStatus?.status || queueStatus?.state || queueStatus?.status_code
        );

        console.error("[video-status] FAL status:", {
          jobId,
          requestId: job.provider_request_id,
          status: normalizedStatus,
          raw: queueStatus,
        });

        if (normalizedStatus === "FAILED") {
          const falErr =
            queueStatus?.error?.message ||
            queueStatus?.message ||
            "fal job failed";

          await admin
            .from("video_jobs")
            .update({
              status: "FAILED",
              provider_status: "FAILED",
              error: falErr,
              provider_error: safeStringify(queueStatus),
              provider_reply: queueStatus,
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
            error: falErr,
            job,
          });
        }

        if (normalizedStatus !== "COMPLETED") {
          await admin
            .from("video_jobs")
            .update({
              status: "IN_PROGRESS",
              provider_status: normalizedStatus || "IN_PROGRESS",
              provider_reply: queueStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);

          return json(res, 200, {
            ok: true,
            status: "IN_PROGRESS",
            rp_status: normalizedStatus,
            job: { ...job, provider_reply: queueStatus },
          });
        }

        const falResult = await fal.queue.result("wan/v2.6/image-to-video/flash", {
          requestId: String(job.provider_request_id),
        });

        const extracted = extractFalVideoInfo(falResult);

        console.error("[video-status] FAL result extracted:", {
          jobId,
          hasUrl: !!extracted.url,
          hasB64: !!extracted.b64,
          mime: extracted.mime,
        });

        if (extracted.url) {
          try {
            const remoteBuf = await fetchUrlToBuffer(extracted.url);

            const { finalUrl } = await uploadVideoBufferToSupabase({
              admin,
              userId,
              jobId,
              buf: remoteBuf,
              mime: extracted.mime || "video/mp4",
            });

            await admin
              .from("video_jobs")
              .update({
                status: "DONE",
                provider_status: "COMPLETED",
                video_url: finalUrl,
                result_url: extracted.url,
                provider_reply: falResult,
                error: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", jobId);

            return json(res, 200, {
              ok: true,
              status: "DONE",
              video_url: finalUrl,
              remote_video_url: extracted.url,
              job,
            });
          } catch (e) {
            await admin
              .from("video_jobs")
              .update({
                status: "FAILED",
                provider_status: "FAILED",
                error: e?.message || "fal remote video download/upload failed",
                provider_error: safeStringify(falResult),
                provider_reply: falResult,
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
              error: e?.message || "fal remote video download/upload failed",
              job,
            });
          }
        }

        if (extracted.b64) {
          const buf = decodeB64ToBuffer(extracted.b64);

          if (!buf || !buf.length) {
            await admin
              .from("video_jobs")
              .update({
                status: "FAILED",
                provider_status: "FAILED",
                error: "fal COMPLETED but video base64 could not be decoded",
                provider_error: safeStringify(falResult),
                provider_reply: falResult,
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
              error: "fal video base64 decode failed",
              job,
            });
          }

          try {
            const { finalUrl } = await uploadVideoBufferToSupabase({
              admin,
              userId,
              jobId,
              buf,
              mime: extracted.mime || "video/mp4",
            });

            await admin
              .from("video_jobs")
              .update({
                status: "DONE",
                provider_status: "COMPLETED",
                video_url: finalUrl,
                provider_reply: falResult,
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
                error: e?.message || "fal storage upload failed",
                provider_error: safeStringify(falResult),
                provider_reply: falResult,
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
              error: e?.message || "fal storage upload failed",
              job,
            });
          }
        }

        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            provider_reply: falResult,
            provider_error: safeStringify(falResult),
            error: "fal finished but no video payload was found",
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
          error: "fal finished but no video payload was found",
          job,
        });
      } catch (e) {
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            error: e?.message || "fal status failed",
            provider_error: safeStringify({ message: e?.message || String(e) }),
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
          error: e?.message || "fal status failed",
          job,
        });
      }
    }

    // =================================================
    // 16) RUNPOD
    // =================================================

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

      return json(res, 200, {
        ok: true,
        status: "DONE",
        video_url: directUrl,
        job,
      });
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
