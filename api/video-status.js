// api/video-status.js
// ─────────────────────────────────────────────────────────────
// Estado de jobs de video para:
// 1) Google Veo (Express)
// 2) fal.ai WAN 2.6 Flash (Standard) → ElevenLabs + Latentsync
// 3) RunPod (Studio)
// ─────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { GoogleAuth }   from "google-auth-library";
import { fal }          from "@fal-ai/client";
import { fetchVeoOperation } from "../src/lib/veo.js";

// ── Env vars ──────────────────────────────────────────────────
const SUPABASE_URL              = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RUNPOD_API_KEY            = process.env.RUNPOD_API_KEY || process.env.RP_API_KEY || process.env.VIDEO_RUNPOD_API_KEY;
const RUNPOD_ENDPOINT_ID        = process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID || process.env.RP_WAN22_T2V_ENDPOINT || process.env.VIDEO_RUNPOD_ENDPOINT_ID || process.env.VIDEO_RUNPOD_ENDPOINT || null;
const FAL_KEY                   = process.env.FAL_KEY || null;
const ELEVENLABS_API_KEY        = process.env.ELEVENLABS_API_KEY || null;
const VIDEO_BUCKET              = process.env.SUPABASE_VIDEO_BUCKET || "videos";
const BUCKET_PUBLIC             = String(process.env.SUPABASE_VIDEO_BUCKET_PUBLIC ?? "true").toLowerCase() === "true";
const PENDING_PLACEHOLDER       = "[PENDING_EXPORT_FROM_B64]";

if (FAL_KEY) fal.config({ credentials: FAL_KEY });

// ── Voces ElevenLabs (mismo mapa que comercial) ───────────────
const VOICE_MAP = {
  neutro:       { mujer: "htFfPSZGJwjBv1CL0aMD", hombre: "htFfPSZGJwjBv1CL0aMD" },
  guatemalteco: { mujer: "MbMvLOFbicjtQwgx0j2r", hombre: "htFfPSZGJwjBv1CL0aMD" },
  colombiano:   { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  mexicano:     { mujer: "MPAa8GSBiMLjMLVwn0Hq", hombre: "1IVWxPHWEi1qouA3cAop" },
  argentino:    { mujer: "6Mo5ciGH5nWiQacn5FYk", hombre: "JNcXxzrlvFDXcrGo2b47" },
  español:      { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  ingles:       { mujer: "DXFkLCBUTmvXpp2QwZjA", hombre: "sB7vwSCyX0tQmU24cW2C" },
};

function getVoiceId(accent, gender) {
  const a = (accent || "neutro").toLowerCase().trim();
  const g = (gender || "mujer").toLowerCase().trim() === "hombre" ? "hombre" : "mujer";
  return (VOICE_MAP[a] || VOICE_MAP["neutro"])[g] || VOICE_MAP["neutro"]["mujer"];
}

// ── Helpers básicos ───────────────────────────────────────────
function json(res, code, obj) { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); }
function safeStringify(v) { try { return JSON.stringify(v); } catch { return null; } }
function getBearerToken(req) { const h = req.headers.authorization || req.headers.Authorization || ""; const m = String(h).match(/^Bearer\s+(.+)$/i); return m ? m[1] : null; }

async function getUserIdFromRequest(req) {
  const jwt = getBearerToken(req);
  if (!jwt || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.getUser();
  if (error) return null;
  return data?.user?.id || null;
}

function runpodStatusUrl(endpointIdOrUrl, requestId) {
  const v = String(endpointIdOrUrl || "").trim();
  if (!v || !requestId) return null;
  if (v.startsWith("http://") || v.startsWith("https://")) return `${v.replace(/\/run\/?$/i, "")}/status/${requestId}`;
  return `https://api.runpod.ai/v2/${v}/status/${requestId}`;
}

function decodeB64ToBuffer(b64) {
  if (!b64) return null;
  let s = String(b64).trim();
  const comma = s.indexOf(",");
  if (s.startsWith("data:") && comma !== -1) s = s.slice(comma + 1);
  s = s.replace(/\s+/g, "");
  try { return Buffer.from(s, "base64"); } catch { return null; }
}

function safeExtFromMime(mime) { return String(mime || "").toLowerCase().includes("webm") ? "webm" : "mp4"; }

async function fetchUrlToBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch remote video: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function uploadVideoBufferToSupabase({ admin, userId, jobId, buf, mime = "video/mp4", suffix = "" }) {
  const ext = safeExtFromMime(mime);
  const filePath = `${userId}/${jobId}${suffix}.${ext}`;
  const { error: upErr } = await admin.storage.from(VIDEO_BUCKET).upload(filePath, buf, { contentType: mime.includes("video/") ? mime : "video/mp4", upsert: true });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
  let finalUrl = null;
  if (BUCKET_PUBLIC) {
    const { data } = admin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
    finalUrl = data?.publicUrl || null;
  } else {
    const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
    if (!error) finalUrl = data?.signedUrl || null;
  }
  return { filePath, finalUrl };
}

function getRefundAmount(job) {
  const provider = String(job?.provider || "").toLowerCase();
  const payload  = job?.payload || {};
  const mode     = String(payload?.generation_mode || "").toLowerCase();
  const duration = Number(payload?.resolved_duration_s ?? payload?.duration_s ?? 8);
  const hasAudio = !!(payload?.include_audio || payload?.enable_lipsync);
  if (provider === "google_veo" || mode === "express") return 18;
  if (provider === "fal_wan_flash" || mode === "standard") {
    let amount = duration === 15 ? 24 : 17;
    if (hasAudio) amount += 4;
    return amount;
  }
  return 11;
}

async function refundJadesSafe({ admin, job, reason }) {
  try {
    const amount = getRefundAmount(job);
    const { error } = await admin.rpc("refund_jades", { p_user_id: job.user_id, p_amount: amount, p_reason: reason, p_ref: `refund:${job.id}:${reason}` });
    if (error) console.error("[video-status] refund_jades failed:", error.message);
    else console.error("[video-status] refund_jades ok:", { jobId: job.id, amount, reason });
  } catch (e) { console.error("[video-status] refund_jades exception:", e?.message); }
}

// ── Google/GCS helpers ────────────────────────────────────────
function getGoogleCredentials() { const r = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; if (!r) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON"); try { return JSON.parse(r); } catch(e) { throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e?.message}`); } }
async function getGoogleAccessToken() { const auth = new GoogleAuth({ credentials: getGoogleCredentials(), scopes: ["https://www.googleapis.com/auth/cloud-platform"] }); const c = await auth.getClient(); const t = await c.getAccessToken(); return t?.token || t; }
function parseGsUri(gsUri) { const r = String(gsUri || "").trim(); if (!r.startsWith("gs://")) return null; const w = r.slice(5); const s = w.indexOf("/"); return s === -1 ? { bucket: w, objectPath: "" } : { bucket: w.slice(0, s), objectPath: w.slice(s + 1) }; }
async function downloadGcsObjectToBuffer(gsUri) {
  const parsed = parseGsUri(gsUri);
  if (!parsed?.bucket || !parsed?.objectPath) throw new Error(`Invalid gcsUri: ${gsUri}`);
  const token = await getGoogleAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o/${encodeURIComponent(parsed.objectPath)}?alt=media`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Failed to download GCS object: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

// ── Extractores Veo ───────────────────────────────────────────
function deepFindBase64(obj) { if (!obj || typeof obj !== "object") return null; if (typeof obj.bytesBase64Encoded === "string" && obj.bytesBase64Encoded.length > 100) return obj.bytesBase64Encoded; if (typeof obj.bytesBase64 === "string" && obj.bytesBase64.length > 100) return obj.bytesBase64; for (const k of Object.keys(obj)) { const f = deepFindBase64(obj[k]); if (f) return f; } return null; }
function deepFindGcsUri(obj) { if (!obj || typeof obj !== "object") return null; if (typeof obj.gcsUri === "string" && obj.gcsUri.startsWith("gs://")) return obj.gcsUri; for (const k of Object.keys(obj)) { const f = deepFindGcsUri(obj[k]); if (f) return f; } return null; }
function deepFindMimeType(obj) { if (!obj || typeof obj !== "object") return null; if (typeof obj.mimeType === "string" && obj.mimeType.startsWith("video/")) return obj.mimeType; for (const k of Object.keys(obj)) { const f = deepFindMimeType(obj[k]); if (f) return f; } return null; }

function extractVeoVideoPayload(op) {
  const response  = op?.response || {};
  const videos    = Array.isArray(response?.videos) ? response.videos : [];
  const firstVideo = videos[0] || null;
  const directB64 = firstVideo?.bytesBase64Encoded || firstVideo?.bytesBase64 || response?.bytesBase64Encoded || response?.bytesBase64 || deepFindBase64(response) || null;
  const mimeType  = firstVideo?.mimeType || response?.mimeType || deepFindMimeType(response) || "video/mp4";
  const gcsUri    = firstVideo?.gcsUri || response?.gcsUri || deepFindGcsUri(response) || null;
  return { directB64, mimeType, gcsUri, hasVideosArray: videos.length > 0, rawResponse: response };
}

// ── Helpers fal ───────────────────────────────────────────────
function normalizeFalStatus(status) {
  const s = String(status || "").toUpperCase();
  if (["COMPLETED","DONE","SUCCESS","FINISHED"].includes(s)) return "COMPLETED";
  if (["FAILED","ERROR","CANCELLED","CANCELED"].includes(s))  return "FAILED";
  return "IN_PROGRESS";
}

function extractFalVideoInfo(result) {
  const root = result?.data || result || {};
  return {
    url:  root?.video?.url || root?.video_url || root?.videoUrl || root?.output?.video?.url || root?.output?.video_url || null,
    mime: root?.video?.content_type || root?.video?.mime_type || "video/mp4",
    b64:  root?.video_b64 || root?.videoBase64 || null,
    raw:  root,
  };
}

// ══════════════════════════════════════════════════════════════
// ElevenLabs + Latentsync (para Standard WAN)
// ══════════════════════════════════════════════════════════════

async function generateElevenLabsAudio(text, accent, gender) {
  if (!ELEVENLABS_API_KEY) { console.error("[video-status] No ELEVENLABS_API_KEY"); return null; }
  if (!text?.trim())       { console.error("[video-status] No narration_text"); return null; }

  const voiceId = getVoiceId(accent, gender);
  console.error(`[video-status] ElevenLabs voice=${voiceId} accent=${accent} gender=${gender}`);

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_API_KEY },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
    }),
  });

  if (!r.ok) { console.error(`[video-status] ElevenLabs error ${r.status}`); return null; }
  return Buffer.from(await r.arrayBuffer());
}

async function applyLatentsync(videoUrl, audioBuf) {
  if (!FAL_KEY) throw new Error("Missing FAL_KEY for Latentsync");

  // Subir audio a fal storage
  const audioBlob = new Blob([audioBuf], { type: "audio/mpeg" });
  const audioFile = new File([audioBlob], "narration.mp3", { type: "audio/mpeg" });
  fal.config({ credentials: FAL_KEY });
  const audioUpload = await fal.storage.upload(audioFile);
  const audioUrl    = audioUpload?.url || audioUpload;

  console.error("[video-status] Latentsync: video_url=", videoUrl, "audio_url=", audioUrl);

  const result = await fal.subscribe("fal-ai/latentsync", {
    input: { video_url: videoUrl, audio_url: audioUrl },
    pollInterval: 3000,
  });

  const finalVideoUrl = result?.video?.url || result?.data?.video?.url || null;
  if (!finalVideoUrl) throw new Error("Latentsync no devolvió video URL");

  return finalVideoUrl;
}

// ── Handler principal ─────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return json(res, 401, { ok: false, error: "Unauthorized" });

    const jobId = String(req.query?.job_id || "").trim();
    if (!jobId) return json(res, 400, { ok: false, error: "Missing job_id" });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(res, 500, { ok: false, error: "Missing Supabase env" });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: job, error: jobErr } = await admin.from("video_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
    if (jobErr || !job) return json(res, 404, { ok: false, error: "Job not found" });

    if (job.video_url && job.video_url !== PENDING_PLACEHOLDER) {
      return json(res, 200, { ok: true, status: job.status, video_url: job.video_url, job });
    }

    if (!job.provider_request_id) return json(res, 200, { ok: true, status: job.status, job });

    // ══════════════════════════════════════════════════════════
    // GOOGLE VEO
    // ══════════════════════════════════════════════════════════
    if (job.provider === "google_veo") {
      const op       = await fetchVeoOperation(job.provider_request_id);
      const done     = !!op?.done;
      const opError  = op?.error || null;

      if (opError) {
        await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", provider_error: safeStringify(opError), provider_reply: op, error: opError?.message || "Veo operation failed", updated_at: new Date().toISOString() }).eq("id", jobId);
        await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
        return json(res, 200, { ok: true, status: "FAILED", error: opError?.message || "Veo operation failed", job });
      }

      if (!done) {
        await admin.from("video_jobs").update({ status: "IN_PROGRESS", provider_status: "RUNNING", provider_reply: op, updated_at: new Date().toISOString() }).eq("id", jobId);
        return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: "RUNNING", job: { ...job, provider_reply: op } });
      }

      const extracted = extractVeoVideoPayload(op);

      const uploadAndFinish = async (buf) => {
        const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf, mime: extracted.mimeType || "video/mp4" });
        await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: finalUrl, provider_reply: op, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
        return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, job });
      };

      const failVeo = async (msg) => {
        await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", provider_reply: op, provider_error: safeStringify(op), error: msg, updated_at: new Date().toISOString() }).eq("id", jobId);
        await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
        return json(res, 200, { ok: true, status: "FAILED", error: msg, job });
      };

      if (extracted.directB64) {
        try { const buf = decodeB64ToBuffer(extracted.directB64); if (!buf?.length) throw new Error("empty b64"); return await uploadAndFinish(buf); }
        catch (e) { return await failVeo(e?.message || "Veo upload failed"); }
      }
      if (extracted.gcsUri) {
        try { const buf = await downloadGcsObjectToBuffer(extracted.gcsUri); if (!buf?.length) throw new Error("empty GCS"); return await uploadAndFinish(buf); }
        catch (e) { return await failVeo(e?.message || "GCS download failed"); }
      }
      return await failVeo("Veo finished but no video payload was found");
    }

    // ══════════════════════════════════════════════════════════
    // FAL WAN FLASH → ElevenLabs + Latentsync
    // ══════════════════════════════════════════════════════════
    if (job.provider === "fal_wan_flash") {
      if (!FAL_KEY) return json(res, 500, { ok: false, error: "Missing FAL_KEY" });

      try {
        fal.config({ credentials: FAL_KEY });

        const queueStatus       = await fal.queue.status("wan/v2.6/image-to-video/flash", { requestId: String(job.provider_request_id), logs: true });
        const normalizedStatus  = normalizeFalStatus(queueStatus?.status || queueStatus?.state);

        console.error("[video-status] FAL status:", { jobId, status: normalizedStatus });

        if (normalizedStatus === "FAILED") {
          const falErr = queueStatus?.error?.message || queueStatus?.message || "fal job failed";
          await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: falErr, provider_error: safeStringify(queueStatus), provider_reply: queueStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
          await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
          return json(res, 200, { ok: true, status: "FAILED", error: falErr, job });
        }

        if (normalizedStatus !== "COMPLETED") {
          await admin.from("video_jobs").update({ status: "IN_PROGRESS", provider_status: normalizedStatus || "IN_PROGRESS", provider_reply: queueStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
          return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: normalizedStatus, job: { ...job, provider_reply: queueStatus } });
        }

        // WAN terminó — obtener resultado
        const falResult  = await fal.queue.result("wan/v2.6/image-to-video/flash", { requestId: String(job.provider_request_id) });
        const extracted  = extractFalVideoInfo(falResult);

        if (!extracted.url && !extracted.b64) {
          await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", provider_reply: falResult, provider_error: safeStringify(falResult), error: "fal finished but no video payload was found", updated_at: new Date().toISOString() }).eq("id", jobId);
          await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
          return json(res, 200, { ok: true, status: "FAILED", error: "fal finished but no video payload was found", job });
        }

        // Subir video mudo de WAN a storage primero
        let wanVideoUrl = extracted.url;
        if (!wanVideoUrl && extracted.b64) {
          const buf = decodeB64ToBuffer(extracted.b64);
          if (buf?.length) {
            const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf, mime: extracted.mime || "video/mp4", suffix: "_raw" });
            wanVideoUrl = finalUrl;
          }
        }

        if (!wanVideoUrl) {
          await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: "No se pudo obtener URL del video WAN", updated_at: new Date().toISOString() }).eq("id", jobId);
          await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
          return json(res, 200, { ok: true, status: "FAILED", error: "No se pudo obtener URL del video WAN", job });
        }

        // ── Leer parámetros de ElevenLabs del payload ─────────
        const payload        = job?.payload || {};
        const enable_lipsync = !!payload?.enable_lipsync;
        const narration_text = String(payload?.narration_text || "").trim();
        const voice_accent   = String(payload?.voice_accent || "neutro").trim();
        const voice_gender   = String(payload?.voice_gender || "mujer").trim();

        // Si no hay lipsync o no hay texto, guardar video mudo directamente
        if (!enable_lipsync || !narration_text) {
          console.error("[video-status] Standard sin lipsync — guardando video WAN mudo");
          let finalBuf = null;
          if (extracted.url) {
            try { finalBuf = await fetchUrlToBuffer(extracted.url); } catch {}
          } else if (extracted.b64) {
            finalBuf = decodeB64ToBuffer(extracted.b64);
          }

          if (finalBuf?.length) {
            const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf: finalBuf, mime: extracted.mime || "video/mp4" });
            await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: finalUrl, result_url: extracted.url || null, provider_reply: falResult, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
            return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, job });
          }
        }

        // ── ElevenLabs: generar audio ─────────────────────────
        console.error("[video-status] Generando audio ElevenLabs...");
        await admin.from("video_jobs").update({ provider_status: "elevenlabs_processing", updated_at: new Date().toISOString() }).eq("id", jobId);

        const audioBuf = await generateElevenLabsAudio(narration_text, voice_accent, voice_gender);

        if (!audioBuf) {
          // ElevenLabs falló — guardar video mudo de todas formas
          console.error("[video-status] ElevenLabs falló, guardando video mudo");
          let finalBuf = null;
          try { finalBuf = await fetchUrlToBuffer(wanVideoUrl); } catch {}
          if (finalBuf?.length) {
            const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf: finalBuf, mime: "video/mp4" });
            await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: finalUrl, provider_reply: falResult, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
            return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, note: "ElevenLabs failed, silent video delivered", job });
          }
        }

        // ── Latentsync: sincronizar labios ────────────────────
        console.error("[video-status] Aplicando Latentsync...");
        await admin.from("video_jobs").update({ provider_status: "latentsync_processing", updated_at: new Date().toISOString() }).eq("id", jobId);

        let finalVideoUrl = null;
        try {
          finalVideoUrl = await applyLatentsync(wanVideoUrl, audioBuf);
        } catch (lsErr) {
          console.error("[video-status] Latentsync falló:", lsErr?.message);
          // Latentsync falló — entregar video WAN mudo
          let fallbackBuf = null;
          try { fallbackBuf = await fetchUrlToBuffer(wanVideoUrl); } catch {}
          if (fallbackBuf?.length) {
            const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf: fallbackBuf, mime: "video/mp4" });
            await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: finalUrl, provider_reply: falResult, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
            return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, note: "Latentsync failed, silent video delivered", job });
          }
        }

        // ── Descargar video final con lip sync y subir ────────
        console.error("[video-status] Descargando video final con lipsync:", finalVideoUrl);
        const finalBuf = await fetchUrlToBuffer(finalVideoUrl);
        const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf: finalBuf, mime: "video/mp4" });

        await admin.from("video_jobs").update({
          status: "DONE", provider_status: "COMPLETED",
          video_url: finalUrl,
          result_url: finalVideoUrl,
          provider_reply: falResult,
          error: null,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, job });

      } catch (e) {
        await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: e?.message || "fal status failed", provider_error: safeStringify({ message: e?.message }), updated_at: new Date().toISOString() }).eq("id", jobId);
        await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
        return json(res, 200, { ok: true, status: "FAILED", error: e?.message || "fal status failed", job });
      }
    }

    // ══════════════════════════════════════════════════════════
    // RUNPOD
    // ══════════════════════════════════════════════════════════
    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) return json(res, 500, { ok: false, error: "Missing RunPod env" });

    const statusUrl = runpodStatusUrl(RUNPOD_ENDPOINT_ID, job.provider_request_id);
    if (!statusUrl) return json(res, 500, { ok: false, error: "Could not build RunPod status url" });

    const rpResp = await fetch(statusUrl, { headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` } });
    const rpJson = await rpResp.json().catch(() => ({}));

    if (!rpResp.ok) return json(res, 200, { ok: true, status: job.status, rp: rpJson, job });

    const rpStatus = rpJson?.status || null;
    const output   = rpJson?.output || null;
    const directUrl = output?.video_url || output?.videoUrl || null;

    if (rpStatus === "COMPLETED" && directUrl) {
      await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: String(directUrl), provider_reply: rpJson, updated_at: new Date().toISOString() }).eq("id", jobId);
      return json(res, 200, { ok: true, status: "DONE", video_url: directUrl, job });
    }

    const videoB64 = output?.video_b64 || output?.videoB64 || null;
    if (rpStatus === "COMPLETED" && videoB64) {
      const mime = output?.mime || "video/mp4";
      const buf  = decodeB64ToBuffer(videoB64);
      if (!buf?.length) {
        await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: "video_b64 decode failed", updated_at: new Date().toISOString() }).eq("id", jobId);
        await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
        return json(res, 200, { ok: true, status: "FAILED", error: "video_b64 decode failed" });
      }
      try {
        const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf, mime });
        await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: finalUrl, provider_reply: rpJson, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
        return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, job });
      } catch (e) {
        await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: e?.message || "Storage upload failed", updated_at: new Date().toISOString() }).eq("id", jobId);
        await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
        return json(res, 200, { ok: true, status: "FAILED", error: e?.message || "Storage upload failed" });
      }
    }

    if (rpStatus === "FAILED") {
      const workerError = output?.error || rpJson?.error || "RunPod job failed";
      await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: workerError, provider_reply: rpJson, updated_at: new Date().toISOString() }).eq("id", jobId);
      await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
      return json(res, 200, { ok: true, status: "FAILED", error: workerError, rp: rpJson });
    }

    await admin.from("video_jobs").update({ status: "IN_PROGRESS", provider_status: rpStatus || "IN_PROGRESS", provider_reply: rpJson, updated_at: new Date().toISOString() }).eq("id", jobId);
    return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: rpStatus, job });

  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}
