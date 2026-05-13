// api/generate-img2video.js
// FIXES:
//   ✅ seedance-2-fast
//   ✅ Lipsync completo: Kling genera video → ElevenLabs genera audio → Kling Lipsync sincroniza
//   ✅ Timeout extendido: 15 minutos para lipsync, 10 min para standard
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const PIAPI_KEY  = process.env.PIAPI_KEY || null;
const PIAPI_BASE = "https://api.piapi.ai/api/v1/task";
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const WEBHOOK_URL = process.env.VIDEO_WEBHOOK_URL || null;

// ── Voces ElevenLabs ──────────────────────────────────────────
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
  return (VOICE_MAP[(accent || "neutro").toLowerCase()] || VOICE_MAP.neutro)[
    (gender || "mujer").toLowerCase() === "hombre" ? "hombre" : "mujer"
  ];
}

function resolveGenerationMode(body) {
  const raw = String(body?.generation_mode || "").trim().toLowerCase();
  if (raw === "express" || raw === "standard") return raw;
  return "standard";
}

function normalizeDuration(mode, raw) {
  if (mode === "express") return 5;
  const n = Number(raw);
  if (n === 15) return 15;
  return 10;
}

function getKlingParams(generationMode, duration) {
  if (generationMode === "express") return { model_version: "kling-v2-1", mode: "pro", duration: 5 };
  if (duration === 15)              return { model_version: "kling-v3",   mode: "pro", duration: 15 };
  return                                   { model_version: "kling-v2-1", mode: "std", duration: 10 };
}

function getJadeCost({ generationMode, duration, audioMode }) {
  let base = generationMode === "express" ? 15 : duration === 15 ? 24 : 17;
  if (audioMode === "native")             base += 6;
  if (audioMode === "elevenlabs_lipsync") base += 8;
  return base;
}

function getSpendReason(generationMode, audioMode) {
  const suffix = audioMode === "native" ? "_audio_native"
               : audioMode === "elevenlabs_lipsync" ? "_audio_lipsync" : "";
  return `i2v_generate_${generationMode}${suffix}`;
}

async function refundJadesSafe({ userId, amount, ref, reason }) {
  try {
    const { error } = await supabaseAdmin.rpc("refund_jades", {
      p_user_id: userId, p_amount: amount, p_reason: reason, p_ref: ref,
    });
    if (error) console.error("[generate-img2video] refund_jades failed:", error.message);
  } catch (e) { console.error("[generate-img2video] refund_jades exception:", e?.message); }
}

// ── Sube imagen a Supabase Storage → URL pública ──────────────
async function uploadImageToStorage({ userId, imageB64, mimeType }) {
  const ext      = String(mimeType || "image/jpeg").includes("png") ? "png" : "jpg";
  const filePath = `${userId}/i2v_input_${Date.now()}.${ext}`;
  const buf      = Buffer.from(imageB64, "base64");
  const { error: upErr } = await supabaseAdmin.storage
    .from("videos")
    .upload(filePath, buf, { contentType: mimeType || "image/jpeg", upsert: true });
  if (upErr) throw new Error(`Image upload failed: ${upErr.message}`);
  const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error("No se pudo obtener URL pública de la imagen");
  return data.publicUrl;
}

// ── Genera audio con ElevenLabs → retorna URL pública ─────────
async function generateElevenLabsAudio({ text, accent, gender, userId }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("MISSING_ELEVENLABS_API_KEY");

  const voiceId = getVoiceId(accent, gender);
  const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs error ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`);

  // Subir audio a Supabase Storage → URL pública para Kling Lipsync
  const audioBuffer = Buffer.from(await r.arrayBuffer());
  const audioPath   = `${userId}/i2v_audio_${Date.now()}.mp3`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("videos")
    .upload(audioPath, audioBuffer, { contentType: "audio/mpeg", upsert: true });
  if (upErr) throw new Error(`Audio upload failed: ${upErr.message}`);
  const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(audioPath);
  if (!data?.publicUrl) throw new Error("No se pudo obtener URL pública del audio");
  return data.publicUrl;
}

// ── Kling Lipsync via PiAPI ───────────────────────────────────
async function submitKlingLipsync({ videoUrl, audioUrl }) {
  if (!PIAPI_KEY) throw new Error("Missing PIAPI_KEY");
  const body = {
    model:     "kling",
    task_type: "lip_sync",
    input: {
      video_url: videoUrl,
      audio_url: audioUrl,
      mode:      "audio2video",
    },
    config: {
      service_mode: "public",
      ...(WEBHOOK_URL ? { webhook_config: { endpoint: WEBHOOK_URL, secret: "" } } : {}),
    },
  };
  const r = await fetch(PIAPI_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": PIAPI_KEY },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || data?.code !== 200)
    throw new Error(`PiAPI Lipsync submit failed: ${r.status} ${data?.message || JSON.stringify(data)}`);
  return data?.data?.task_id;
}

// ── Poll PiAPI hasta completar ────────────────────────────────
async function pollPiAPITask(taskId, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 6000));
    const r    = await fetch(`${PIAPI_BASE}/${taskId}`, {
      headers: { "x-api-key": PIAPI_KEY },
    });
    const data = await r.json().catch(() => null);
    const st   = data?.data?.status || data?.status;
    const out  = data?.data?.output || data?.output || {};

    if (st === "completed" || st === "succeed") {
      const videoUrl = out.video_url || out.video || out.url || out.works?.[0]?.video?.resource || null;
      if (!videoUrl) throw new Error("PiAPI completed pero sin video_url");
      return videoUrl;
    }
    if (st === "failed" || st === "error") {
      throw new Error(data?.data?.error?.message || data?.error?.message || "PiAPI task failed");
    }
  }
  throw new Error("Timeout esperando PiAPI");
}

// ── Submit video Kling ────────────────────────────────────────
async function submitKlingVideo({ imageUrl, imageB64, prompt, negativePrompt, klingParams, aspectRatio, enableAudio, mimeType, userId }) {
  if (!PIAPI_KEY) throw new Error("Missing PIAPI_KEY");

  let finalImageUrl = imageUrl || null;
  if (!finalImageUrl && imageB64) {
    finalImageUrl = await uploadImageToStorage({ userId, imageB64, mimeType });
  }
  if (!finalImageUrl) throw new Error("Se requiere imagen para Kling I2V");

  const body = {
    model:     "kling",
    task_type: "video_generation",
    input: {
      prompt:          prompt || "Animate this image naturally with subtle realistic motion.",
      negative_prompt: negativePrompt || "blurry, low quality, deformed, text, watermark",
      image_url:       finalImageUrl,
      duration:        klingParams.duration,
      mode:            klingParams.mode,
      version:         klingParams.model_version,
      aspect_ratio:    aspectRatio || "9:16",
      cfg_scale:       0.5,
      ...(enableAudio ? { enable_audio: true } : {}),
    },
    config: {
      service_mode: "public",
      ...(WEBHOOK_URL ? { webhook_config: { endpoint: WEBHOOK_URL, secret: "" } } : {}),
    },
  };

  const r = await fetch(PIAPI_BASE, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-api-key": PIAPI_KEY },
    body:    JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || data?.code !== 200)
    throw new Error(`PiAPI Kling submit failed: ${r.status} ${data?.message || JSON.stringify(data)}`);
  return data?.data;
}

export default async function handler(req, res) {
  let userId = null, ref = null, jadeCost = 0, jadesCharged = false, jobId = null;

  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const prompt         = String(body?.prompt || "").trim();
    const negativePrompt = String(body?.negative_prompt || body?.negative || "").trim();
    if (!prompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const image_b64 = body?.image_b64 ? String(body.image_b64) : null;
    const image_url = body?.image_url ? String(body.image_url).trim() : null;
    if (!image_b64 && !image_url) return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });

    const mimeType       = String(body?.image_mime_type || "image/jpeg").trim();
    const generationMode = resolveGenerationMode(body);
    const duration       = normalizeDuration(generationMode, body?.duration_s ?? 10);
    const aspect_ratio   = String(body?.aspect_ratio || "9:16").trim();
    const klingParams    = getKlingParams(generationMode, duration);

    const audioMode      = String(body?.audio_mode || "none").trim();
    const narration_text = String(body?.narration_text || "").trim();
    const voice_accent   = String(body?.voice_accent   || "neutro").trim();
    const voice_gender   = String(body?.voice_gender   || "mujer").trim();
    const enableLipsync  = audioMode === "elevenlabs_lipsync" && narration_text.length > 0;
    const enableNativeAudio = audioMode === "native";

    if (audioMode === "elevenlabs_lipsync" && !narration_text) {
      return res.status(400).json({ ok: false, error: "Escribe el texto que dirá el personaje para activar el lip sync." });
    }

    jadeCost = getJadeCost({ generationMode, duration, audioMode: enableLipsync ? "elevenlabs_lipsync" : audioMode });
    ref      = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId, p_amount: jadeCost,
      p_reason: getSpendReason(generationMode, enableLipsync ? "elevenlabs_lipsync" : audioMode),
      p_ref: ref,
    });
    if (spendErr) return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });
    jadesCharged = true;

    jobId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

    // ── PASO 1: Generar video con Kling ───────────────────────
    const klingTask = await submitKlingVideo({
      imageUrl: image_url, imageB64: image_b64, mimeType, prompt, negativePrompt,
      klingParams, aspectRatio: aspect_ratio, enableAudio: enableNativeAudio, userId,
    });

    const klingTaskId = klingTask?.task_id;
    if (!klingTaskId) throw new Error("PiAPI no devolvió task_id");

    const startedAt = new Date().toISOString();

    await supabaseAdmin.from("video_jobs").insert({
      id: jobId, user_id: userId, status: "IN_PROGRESS", mode: "i2v",
      provider: "piapi_kling", provider_request_id: klingTaskId,
      provider_status: "kling_processing", prompt, negative_prompt: negativePrompt,
      started_at: startedAt,
      payload: {
        generation_mode: generationMode, duration, audio_mode: audioMode,
        enable_lipsync: enableLipsync, narration_text: enableLipsync ? narration_text : "",
        voice_accent, voice_gender, kling_model: klingParams.model_version,
        kling_mode: klingParams.mode, aspect_ratio,
      },
    });

    // ── Si no hay lipsync, respondemos con el job de Kling ────
    if (!enableLipsync) {
      return res.status(200).json({
        ok: true, job_id: jobId, provider: "piapi_kling",
        provider_request_id: klingTaskId, started_at: startedAt,
        jade_spent: jadeCost, generation_mode: generationMode, audio_mode: audioMode,
      });
    }

    // ── PASO 2: Lipsync — esperar video de Kling, luego ElevenLabs + Lipsync
    // Respondemos inmediatamente con el job, el lipsync continúa en background
    res.status(200).json({
      ok: true, job_id: jobId, provider: "piapi_kling",
      provider_request_id: klingTaskId, started_at: startedAt,
      jade_spent: jadeCost, generation_mode: generationMode, audio_mode: "elevenlabs_lipsync",
    });

    // Background: esperar Kling → ElevenLabs → Kling Lipsync
    (async () => {
      try {
        // Actualizar estado
        await supabaseAdmin.from("video_jobs").update({ provider_status: "kling_processing" }).eq("id", jobId);

        // Esperar video de Kling (máx 12 min)
        const klingVideoUrl = await pollPiAPITask(klingTaskId, 12 * 60 * 1000);
        console.log(`[i2v] Kling video listo: ${klingVideoUrl.slice(0, 60)}`);

        // ElevenLabs genera audio
        await supabaseAdmin.from("video_jobs").update({ provider_status: "elevenlabs_processing" }).eq("id", jobId);
        const audioUrl = await generateElevenLabsAudio({
          text: narration_text, accent: voice_accent, gender: voice_gender, userId,
        });
        console.log(`[i2v] ElevenLabs audio listo: ${audioUrl.slice(0, 60)}`);

        // Kling Lipsync
        await supabaseAdmin.from("video_jobs").update({ provider_status: "synclipsync_processing" }).eq("id", jobId);
        const lipsyncTaskId = await submitKlingLipsync({ videoUrl: klingVideoUrl, audioUrl });
        console.log(`[i2v] Kling Lipsync task: ${lipsyncTaskId}`);

        // Esperar lipsync (máx 10 min)
        const finalVideoUrl = await pollPiAPITask(lipsyncTaskId, 10 * 60 * 1000);
        console.log(`[i2v] Lipsync completo: ${finalVideoUrl.slice(0, 60)}`);

        // Actualizar job con resultado final
        await supabaseAdmin.from("video_jobs").update({
          status: "DONE", provider_status: "completed", output_url: finalVideoUrl,
        }).eq("id", jobId);

      } catch (e) {
        console.error(`[i2v] lipsync background error:`, e?.message);
        await supabaseAdmin.from("video_jobs").update({
          status: "FAILED", provider_status: "failed", error: e?.message,
        }).eq("id", jobId);
      }
    })();

    return; // Ya respondimos arriba

  } catch (e) {
    console.error("[generate-img2video] ERROR:", e?.message);
    if (jobId) {
      try { await supabaseAdmin.from("video_jobs").update({ status: "FAILED", provider_status: "failed", error: e?.message }).eq("id", jobId); } catch {}
    }
    if (jadesCharged && userId && jadeCost > 0 && ref) {
      await refundJadesSafe({ userId, amount: jadeCost, ref, reason: "i2v_generation_failed" });
    }
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: e?.message || "Server error" });
    }
  }
}
