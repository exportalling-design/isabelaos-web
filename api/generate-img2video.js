// api/generate-img2video.js
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const PIAPI_KEY  = process.env.PIAPI_KEY || null;
const PIAPI_BASE = "https://api.piapi.ai/api/v1/task";
const WEBHOOK_URL = process.env.VIDEO_WEBHOOK_URL || null;

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

// Sube imagen base64 a Supabase Storage y retorna URL publica
// PiAPI Kling NO acepta data URLs — necesita URL HTTP/HTTPS publica
async function uploadImageToStorage({ userId, imageB64, mimeType }) {
  const ext      = String(mimeType || "image/jpeg").includes("png") ? "png" : "jpg";
  const filePath = `${userId}/i2v_input_${Date.now()}.${ext}`;
  const buf      = Buffer.from(imageB64, "base64");
  const { error: upErr } = await supabaseAdmin.storage
    .from("videos")
    .upload(filePath, buf, { contentType: mimeType || "image/jpeg", upsert: true });
  if (upErr) throw new Error(`Image upload failed: ${upErr.message}`);
  const { data } = supabaseAdmin.storage.from("videos").getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error("No se pudo obtener URL publica de la imagen");
  return data.publicUrl;
}

async function submitKlingVideo({ imageUrl, imageB64, prompt, negativePrompt, klingParams, aspectRatio, enableAudio, mimeType, userId }) {
  if (!PIAPI_KEY) throw new Error("Missing PIAPI_KEY");

  // Si viene URL publica usarla directo, si viene base64 subirla primero
  let finalImageUrl = imageUrl || null;
  if (!finalImageUrl && imageB64) {
    finalImageUrl = await uploadImageToStorage({ userId, imageB64, mimeType });
  }
  if (!finalImageUrl) throw new Error("Se requiere imagen para Kling I2V");

  const body = {
    model: "kling",
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
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": PIAPI_KEY },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok || data?.code !== 200) {
    throw new Error(`PiAPI Kling submit failed: ${r.status} ${data?.message || JSON.stringify(data)}`);
  }
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

    const image_b64 = body?.image_b64 ? String(body.image_b64)        : null;
    const image_url = body?.image_url ? String(body.image_url).trim() : null;
    if (!image_b64 && !image_url) return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });

    const mimeType       = String(body?.image_mime_type || "image/jpeg").trim();
    const generationMode = resolveGenerationMode(body);
    const duration       = normalizeDuration(generationMode, body?.duration_s ?? 10);
    const aspect_ratio   = String(body?.aspect_ratio || "9:16").trim();
    const klingParams    = getKlingParams(generationMode, duration);

    const audioMode         = String(body?.audio_mode || "none").trim();
    const enableNativeAudio = audioMode === "native";
    const narration_text    = String(body?.narration_text || "").trim();
    const voice_accent      = String(body?.voice_accent   || "neutro").trim();
    const voice_gender      = String(body?.voice_gender   || "mujer").trim();
    const enableLipsync     = audioMode === "elevenlabs_lipsync" && narration_text.length > 0;

    if (audioMode === "elevenlabs_lipsync" && !narration_text) {
      return res.status(400).json({ ok: false, error: "Escribe el texto que dira el personaje para activar el lip sync." });
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

    const klingTask = await submitKlingVideo({
      imageUrl:    image_url,
      imageB64:    image_b64,
      mimeType,
      prompt,
      negativePrompt,
      klingParams,
      aspectRatio: aspect_ratio,
      enableAudio: enableNativeAudio,
      userId,
    });

    const providerRequestId = klingTask?.task_id || null;
    if (!providerRequestId) throw new Error("PiAPI no devolvio task_id");

    const startedAt = new Date().toISOString();

    await supabaseAdmin.from("video_jobs").insert({
      id:                  jobId,
      user_id:             userId,
      status:              "IN_PROGRESS",
      mode:                "i2v",
      provider:            "piapi_kling",
      provider_request_id: providerRequestId,
      provider_status:     "kling_processing",
      prompt,
      negative_prompt:     negativePrompt,
      started_at:          startedAt,
      payload: {
        generation_mode: generationMode,
        duration,
        audio_mode:      audioMode,
        enable_lipsync:  enableLipsync,
        narration_text:  enableLipsync ? narration_text : "",
        voice_accent,
        voice_gender,
        kling_model:     klingParams.model_version,
        kling_mode:      klingParams.mode,
        aspect_ratio,
      },
    });

    return res.status(200).json({
      ok: true,
      job_id:              jobId,
      provider:            "piapi_kling",
      provider_request_id: providerRequestId,
      started_at:          startedAt,
      jade_spent:          jadeCost,
      generation_mode:     generationMode,
      audio_mode:          audioMode,
    });

  } catch (e) {
    console.error("[generate-img2video] ERROR:", e?.message);
    if (jobId) {
      try { await supabaseAdmin.from("video_jobs").update({ status: "FAILED", provider_status: "failed", error: e?.message }).eq("id", jobId); } catch {}
    }
    if (jadesCharged && userId && jadeCost > 0 && ref) {
      await refundJadesSafe({ userId, amount: jadeCost, ref, reason: "i2v_generation_failed" });
    }
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
