// api/video-status.js
// ─────────────────────────────────────────────────────────────
// Polling de jobs Kling vía PiAPI
// Pipeline Standard con ElevenLabs + Lipsync:
//   1. poll Kling → COMPLETED → tenemos video mudo
//   2. ElevenLabs TTS → audio buffer
//   3. PiAPI Kling lip_sync submit → guardamos lipsync_task_id
//   4. polls siguientes → solo checar lipsync_task_id
//      NUNCA relanzar un job ya enviado
// ─────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL              = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PIAPI_KEY                 = process.env.PIAPI_KEY || null;
const ELEVENLABS_API_KEY        = process.env.ELEVENLABS_API_KEY || null;
const VIDEO_BUCKET              = process.env.SUPABASE_VIDEO_BUCKET || "videos";
const BUCKET_PUBLIC             = String(process.env.SUPABASE_VIDEO_BUCKET_PUBLIC ?? "true").toLowerCase() === "true";
const PIAPI_BASE                = "https://api.piapi.ai/api/v1/task";

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

function safeExtFromMime(mime) { return String(mime || "").toLowerCase().includes("webm") ? "webm" : "mp4"; }

async function fetchUrlToBuffer(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status} ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function uploadVideoBufferToSupabase({ admin, userId, jobId, buf, mime = "video/mp4", suffix = "" }) {
  const ext      = safeExtFromMime(mime);
  const filePath = `${userId}/${jobId}${suffix}.${ext}`;
  const { error: upErr } = await admin.storage.from(VIDEO_BUCKET).upload(filePath, buf, { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);
  let finalUrl = null;
  if (BUCKET_PUBLIC) {
    const { data } = admin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
    finalUrl = data?.publicUrl || null;
  } else {
    const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
    if (!error) finalUrl = data?.signedUrl || null;
  }
  return { finalUrl };
}

function getRefundAmount(job) {
  const payload  = job?.payload || {};
  const mode     = String(payload?.generation_mode || "standard").toLowerCase();
  const duration = Number(payload?.duration ?? 10);
  const audio    = String(payload?.audio_mode || "none");
  let base = mode === "express" ? 15 : duration === 15 ? 24 : 17;
  if (audio === "native")             base += 6;
  if (audio === "elevenlabs_lipsync") base += 8;
  return base;
}

async function refundJadesSafe({ admin, job, reason }) {
  try {
    const amount = getRefundAmount(job);
    const { error } = await admin.rpc("refund_jades", { p_user_id: job.user_id, p_amount: amount, p_reason: reason, p_ref: `refund:${job.id}:${reason}` });
    if (error) console.error("[video-status] refund failed:", error.message);
    else console.error("[video-status] refund ok:", { jobId: job.id, amount, reason });
  } catch (e) { console.error("[video-status] refund exception:", e?.message); }
}

// ── PiAPI helpers ─────────────────────────────────────────────
function normalizePiapiStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["completed","done","success"].includes(s)) return "COMPLETED";
  if (["failed","error","cancelled"].includes(s))  return "FAILED";
  return "IN_PROGRESS";
}

async function getPiapiTask(taskId) {
  const r = await fetch(`${PIAPI_BASE}/${taskId}`, {
    headers: { "x-api-key": PIAPI_KEY },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`PiAPI task fetch failed: ${r.status}`);
  return data?.data;
}

function extractKlingVideoUrl(task) {
  return task?.output?.video_url
      || task?.output?.works?.[0]?.video?.resource
      || task?.output?.works?.[0]?.video?.url
      || null;
}

// ── ElevenLabs TTS ────────────────────────────────────────────
async function generateElevenLabsAudio(text, accent, gender) {
  if (!ELEVENLABS_API_KEY || !text?.trim()) return null;
  const voiceId = getVoiceId(accent, gender);
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_API_KEY },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!r.ok) { console.error("[video-status] ElevenLabs error:", r.status); return null; }
  return Buffer.from(await r.arrayBuffer());
}

// ── Sube audio a Supabase Storage y retorna URL pública ───────
async function uploadAudioToSupabase({ admin, userId, jobId, audioBuf }) {
  const filePath = `${userId}/${jobId}_audio.mp3`;
  const { error } = await admin.storage.from(VIDEO_BUCKET).upload(filePath, audioBuf, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Error(`Audio upload failed: ${error.message}`);
  if (BUCKET_PUBLIC) {
    const { data } = admin.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
    return data?.publicUrl || null;
  }
  const { data, error: signErr } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(filePath, 60 * 60 * 2);
  if (signErr) throw new Error(`Audio signed url failed: ${signErr.message}`);
  return data?.signedUrl || null;
}

// ── Kling Lipsync submit vía PiAPI (UNA SOLA VEZ) ────────────
// Usa local_dubbing_url con el audio de ElevenLabs
// Retorna el task_id del job de lipsync
async function submitKlingLipsync({ videoUrl, audioUrl }) {
  if (!PIAPI_KEY) throw new Error("Missing PIAPI_KEY for lipsync");

  const body = {
    model: "kling",
    task_type: "lip_sync",
    input: {
      video_url:         videoUrl,
      tts_text:          "",
      tts_timbre:        "",
      tts_speed:         1,
      local_dubbing_url: audioUrl,
    },
    config: { service_mode: "public" },
  };

  const r = await fetch(PIAPI_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": PIAPI_KEY },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || data?.code !== 200) {
    throw new Error(`Kling lipsync submit failed: ${r.status} ${data?.message || ""}`);
  }
  const taskId = data?.data?.task_id || null;
  if (!taskId) throw new Error("Kling lipsync no devolvió task_id");
  console.error("[video-status] Kling lipsync submitted:", taskId);
  return taskId;
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

    // Ya tiene video — devolver directo
    if (job.video_url) return json(res, 200, { ok: true, status: job.status, video_url: job.video_url, job });
    if (!job.provider_request_id) return json(res, 200, { ok: true, status: job.status, job });

    const payload        = job.payload || {};
    const enable_lipsync = !!payload?.enable_lipsync;
    const audio_mode     = String(payload?.audio_mode || "none");

    // ══════════════════════════════════════════════════════════
    // RAMA A: Lipsync ya fue enviado a Kling — solo checar status
    // NUNCA relanzar si lipsync_task_id ya existe en payload
    // ══════════════════════════════════════════════════════════
    if (payload?.pipeline_stage === "lipsync_submitted" && payload?.lipsync_task_id) {
      const lsTaskId = String(payload.lipsync_task_id);
      let lsTask = null;
      try { lsTask = await getPiapiTask(lsTaskId); } catch (e) {
        return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: "synclipsync_processing", job });
      }
      const lsStatus = normalizePiapiStatus(lsTask?.status);
      console.error("[video-status] Kling lipsync poll:", { lsTaskId, lsStatus });

      if (lsStatus === "FAILED") {
        // Lipsync falló → entregar video mudo de Kling como fallback
        const wanVideoUrl = String(payload?.kling_video_url || "");
        if (wanVideoUrl) {
          try {
            const buf = await fetchUrlToBuffer(wanVideoUrl);
            const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf });
            await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: finalUrl, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
            return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, note: "Lipsync failed, mute video delivered", job });
          } catch {}
        }
        await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: "Kling lipsync failed", updated_at: new Date().toISOString() }).eq("id", jobId);
        await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
        return json(res, 200, { ok: true, status: "FAILED", error: "Kling lipsync failed", job });
      }

      if (lsStatus !== "COMPLETED") {
        await admin.from("video_jobs").update({ provider_status: "synclipsync_processing", updated_at: new Date().toISOString() }).eq("id", jobId);
        return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: "synclipsync_processing", job });
      }

      // Lipsync completado
      const lsVideoUrl = extractKlingVideoUrl(lsTask);
      if (!lsVideoUrl) {
        await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: "Lipsync no devolvió video URL", updated_at: new Date().toISOString() }).eq("id", jobId);
        await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
        return json(res, 200, { ok: true, status: "FAILED", error: "Lipsync no devolvió video URL", job });
      }

      const buf = await fetchUrlToBuffer(lsVideoUrl);
      const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf });
      await admin.from("video_jobs").update({
        status: "DONE", provider_status: "COMPLETED",
        video_url: finalUrl, result_url: lsVideoUrl,
        error: null, updated_at: new Date().toISOString(),
        payload: { ...payload, pipeline_stage: "done" },
      }).eq("id", jobId);
      return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, job });
    }

    // ══════════════════════════════════════════════════════════
    // RAMA B: Kling video todavía procesando o recién terminó
    // ══════════════════════════════════════════════════════════
    let klingTask = null;
    try { klingTask = await getPiapiTask(job.provider_request_id); } catch (e) {
      return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: "kling_processing", job });
    }

    const klingStatus = normalizePiapiStatus(klingTask?.status);
    console.error("[video-status] Kling video poll:", { jobId, klingStatus });

    if (klingStatus === "FAILED") {
      const errMsg = klingTask?.error?.message || klingTask?.error?.raw_message || klingTask?.detail || JSON.stringify(klingTask?.error) || "Kling video failed";
      console.error("[video-status] Kling FAILED detail:", JSON.stringify(klingTask?.error || klingTask));
      await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: errMsg, updated_at: new Date().toISOString() }).eq("id", jobId);
      await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
      return json(res, 200, { ok: true, status: "FAILED", error: errMsg, job });
    }

    if (klingStatus !== "COMPLETED") {
      await admin.from("video_jobs").update({ provider_status: "kling_processing", updated_at: new Date().toISOString() }).eq("id", jobId);
      return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: "kling_processing", job });
    }

    // Kling terminó — obtener URL del video
    const klingVideoUrl = extractKlingVideoUrl(klingTask);
    if (!klingVideoUrl) {
      await admin.from("video_jobs").update({ status: "FAILED", provider_status: "FAILED", error: "Kling no devolvió video URL", updated_at: new Date().toISOString() }).eq("id", jobId);
      await refundJadesSafe({ admin, job, reason: "i2v_generation_failed" });
      return json(res, 200, { ok: true, status: "FAILED", error: "Kling no devolvió video URL", job });
    }

    // Sin lipsync → descargar y guardar directo
    if (!enable_lipsync || audio_mode !== "elevenlabs_lipsync") {
      console.error("[video-status] Kling completado sin lipsync, guardando video...");
      const buf = await fetchUrlToBuffer(klingVideoUrl);
      const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf });
      await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: finalUrl, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
      return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, job });
    }

    // ── Con lipsync: ElevenLabs → audio → Kling lipsync submit ──
    console.error("[video-status] Generando audio ElevenLabs...");
    await admin.from("video_jobs").update({ provider_status: "elevenlabs_processing", updated_at: new Date().toISOString() }).eq("id", jobId);

    const narration_text = String(payload?.narration_text || "").trim();
    const voice_accent   = String(payload?.voice_accent   || "neutro").trim();
    const voice_gender   = String(payload?.voice_gender   || "mujer").trim();

    const audioBuf = await generateElevenLabsAudio(narration_text, voice_accent, voice_gender);

    if (!audioBuf) {
      // ElevenLabs falló → entregar video mudo
      console.error("[video-status] ElevenLabs falló, entregando video mudo");
      const buf = await fetchUrlToBuffer(klingVideoUrl);
      const { finalUrl } = await uploadVideoBufferToSupabase({ admin, userId, jobId, buf });
      await admin.from("video_jobs").update({ status: "DONE", provider_status: "COMPLETED", video_url: finalUrl, error: null, updated_at: new Date().toISOString() }).eq("id", jobId);
      return json(res, 200, { ok: true, status: "DONE", video_url: finalUrl, note: "ElevenLabs failed, mute video delivered", job });
    }

    // Subir audio a Supabase Storage para tener URL pública que Kling pueda acceder
    console.error("[video-status] Subiendo audio a Supabase Storage...");
    const audioUrl = await uploadAudioToSupabase({ admin, userId, jobId, audioBuf });
    if (!audioUrl) throw new Error("No se pudo obtener URL pública del audio");

    // Submit Kling lipsync UNA SOLA VEZ — guardar task_id en payload antes de responder
    console.error("[video-status] Enviando Kling lipsync (submit única vez)...");
    const lsTaskId = await submitKlingLipsync({ videoUrl: klingVideoUrl, audioUrl });

    await admin.from("video_jobs").update({
      provider_status: "synclipsync_processing",
      updated_at: new Date().toISOString(),
      payload: {
        ...payload,
        pipeline_stage:   "lipsync_submitted",
        lipsync_task_id:  lsTaskId,
        kling_video_url:  klingVideoUrl,
      },
    }).eq("id", jobId);

    return json(res, 200, { ok: true, status: "IN_PROGRESS", rp_status: "synclipsync_processing", job });

  } catch (e) {
    console.error("[video-status] ERROR:", e?.message);
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}
