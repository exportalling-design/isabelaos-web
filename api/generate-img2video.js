import { fal } from "@fal-ai/client";
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";
import { generateVeoVideo } from "../src/lib/veo.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

const FAL_KEY = process.env.FAL_KEY || null;

function pickI2VEndpointId() {
  return (
    process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.VIDEO_RUNPOD_ENDPOINT ||
    null
  );
}

if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

async function runpodRun({ endpointId, input }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing I2V endpoint id env var");

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

async function falQueueSubmit({ input }) {
  if (!FAL_KEY) throw new Error("Missing FAL_KEY");

  fal.config({ credentials: FAL_KEY });

  const result = await fal.queue.submit("wan/v2.6/image-to-video/flash", {
    input,
  });

  return result;
}

function pickFinalPrompts(body) {
  const b = body || {};

  const finalPrompt =
    String(b?.finalPrompt || "").trim() ||
    String(b?.optimizedPrompt || "").trim() ||
    String(b?.prompt || "").trim();

  const finalNegative =
    String(b?.finalNegative || "").trim() ||
    String(b?.optimizedNegative || "").trim() ||
    String(b?.negative_prompt || b?.negative || "").trim();

  return { finalPrompt, finalNegative };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (x) => Number.isFinite(Number(x));

function inferImageMimeType(body) {
  const explicit =
    String(body?.image_mime_type || body?.mimeType || body?.imageMimeType || "").trim();

  if (explicit) return explicit;

  const dataUrl = String(body?.image_data_url || "").trim();
  if (dataUrl.startsWith("data:image/jpeg")) return "image/jpeg";
  if (dataUrl.startsWith("data:image/jpg")) return "image/jpeg";
  if (dataUrl.startsWith("data:image/webp")) return "image/webp";
  if (dataUrl.startsWith("data:image/png")) return "image/png";

  return "image/png";
}

function resolveGenerationMode(body) {
  const raw = String(body?.generation_mode || body?.mode_name || "").trim().toLowerCase();

  if (raw === "express" || raw === "standard" || raw === "studio") {
    return raw;
  }

  if (typeof body?.is_fast_mode === "boolean") {
    return body.is_fast_mode ? "express" : "studio";
  }

  return "express";
}

function normalizeDurationByMode(mode, raw) {
  const n = Number(raw);

  if (mode === "express") {
    return 8;
  }

  if (mode === "studio") {
    return 5;
  }

  if (n === 15) return 15;
  if (n === 10) return 10;
  if (n === 8) return 10;
  if (n === 5) return 5;

  return 10;
}

function getModeProvider(mode) {
  if (mode === "express") return "google_veo";
  if (mode === "standard") return "fal_wan_flash";
  return "runpod";
}

function getSpendReason(mode, hasAudioLayer) {
  if (mode === "express") {
    return hasAudioLayer ? "i2v_generate_express_audio" : "i2v_generate_express";
  }
  if (mode === "standard") {
    return hasAudioLayer ? "i2v_generate_standard_audio" : "i2v_generate_standard";
  }
  return "i2v_generate_studio";
}

function getJadeCost({ mode, duration, hasAudioLayer }) {
  let base = 0;

  if (mode === "express") {
    base = 18;
  } else if (mode === "standard") {
    if (duration === 15) base = 24;
    else if (duration === 10) base = 17;
    else base = 12;
  } else {
    base = 11;
  }

  if ((mode === "express" || mode === "standard") && hasAudioLayer) {
    base += 4;
  }

  return base;
}

function toFalImageUrl({ image_b64, image_url, imageMimeType }) {
  if (image_url) return image_url;
  if (!image_b64) return null;
  return `data:${imageMimeType};base64,${image_b64}`;
}

function getResolutionForMode({ mode, width, height }) {
  if (mode !== "standard") return null;

  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const maxSide = Math.max(w, h);

  return maxSide >= 1000 ? "1080p" : "720p";
}

function mergeNegativePrompts(baseNegative, extraNegative) {
  const a = String(baseNegative || "").trim();
  const b = String(extraNegative || "").trim();

  if (a && b) return `${a}, ${b}`;
  return a || b || "";
}

function applyAudioPolicy({ mode, prompt, negativePrompt, audioLayerEnabled }) {
  const cleanPrompt = String(prompt || "").trim();
  const cleanNegative = String(negativePrompt || "").trim();

  if (mode === "studio") {
    const silentInstruction =
      "silent video, no audio, no voice, no speech, no dialogue, no talking, no singing, no soundtrack, no music";
    return {
      finalPrompt: cleanPrompt ? `${cleanPrompt}. ${silentInstruction}.` : silentInstruction,
      finalNegative: mergeNegativePrompts(
        cleanNegative,
        "audio, voice, speech, dialogue, talking, singing, soundtrack, music, lip sync"
      ),
      resolvedIncludeAudio: false,
    };
  }

  if (!audioLayerEnabled) {
    const silentInstruction =
      "silent video only, no audio, no voice, no speech, no dialogue, no talking, no singing, no soundtrack, no ambient sound, no music";
    return {
      finalPrompt: cleanPrompt ? `${cleanPrompt}. ${silentInstruction}.` : silentInstruction,
      finalNegative: mergeNegativePrompts(
        cleanNegative,
        "audio, voice, speech, dialogue, talking, singing, soundtrack, music, ambient sound, lip sync"
      ),
      resolvedIncludeAudio: false,
    };
  }

  return {
    finalPrompt: cleanPrompt,
    finalNegative: cleanNegative,
    resolvedIncludeAudio: true,
  };
}

async function refundJadesSafe({ userId, amount, ref, reason }) {
  try {
    const { error } = await supabaseAdmin.rpc("refund_jades", {
      p_user_id: userId,
      p_amount: amount,
      p_reason: reason,
      p_ref: ref,
    });

    if (error) {
      console.error("[generate-img2video] refund_jades failed:", error.message);
    } else {
      console.error("[generate-img2video] refund_jades ok:", {
        userId,
        amount,
        reason,
        ref,
      });
    }
  } catch (e) {
    console.error("[generate-img2video] refund_jades exception:", e?.message || e);
  }
}

export default async function handler(req, res) {
  let userId = null;
  let ref = null;
  let jadeCost = 0;
  let jadesCharged = false;
  let jobId = null;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    userId = await getUserIdFromAuthHeader(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { finalPrompt, finalNegative } = pickFinalPrompts(body);

    if (!finalPrompt) {
      return res.status(400).json({ ok: false, error: "Falta prompt" });
    }

    const image_b64 = body?.image_b64 ? String(body.image_b64) : null;
    const image_url = body?.image_url ? String(body.image_url).trim() : null;

    if (!image_b64 && !image_url) {
      return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });
    }

    const imageMimeType = inferImageMimeType(body);
    const generationMode = resolveGenerationMode(body);
    const provider = getModeProvider(generationMode);

    const aspect_ratio = String(body?.aspect_ratio || "").trim() || "9:16";
    const duration_s = normalizeDurationByMode(
      generationMode,
      body?.duration_s ?? body?.seconds ?? 8
    );

    const fps = Number(body?.fps ?? 16);
    const num_frames = Number(body?.num_frames ?? body?.frames ?? 48);
    const steps = Number(body?.steps ?? 18);

    const guidance_scale_raw = body?.guidance_scale ?? body?.cfg ?? 5.0;
    const guidance_scale = clamp(Number(guidance_scale_raw), 1.0, 10.0);

    const denoise_raw = body?.denoise ?? body?.strength ?? 0.45;
    const denoise = clamp(Number(denoise_raw), 0.2, 0.8);

    const seed = isNum(body?.seed) ? Number(body.seed) : 12345;

    const motion_strength_raw = body?.motion_strength ?? 0.6;
    const motion_strength = clamp(Number(motion_strength_raw), 0.1, 1.0);

    const width =
      body?.width !== undefined && body?.width !== null && body?.width !== ""
        ? Number(body.width)
        : aspect_ratio === "9:16"
          ? 576
          : 832;

    const height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : aspect_ratio === "9:16"
          ? 1024
          : 480;

    const requestedAudioLayer = !!body?.include_audio && generationMode !== "studio";

    const audioPolicy = applyAudioPolicy({
      mode: generationMode,
      prompt: finalPrompt,
      negativePrompt: finalNegative,
      audioLayerEnabled: requestedAudioLayer,
    });

    const resolvedPrompt = audioPolicy.finalPrompt;
    const resolvedNegative = audioPolicy.finalNegative;
    const include_audio = audioPolicy.resolvedIncludeAudio;

    const resolution = getResolutionForMode({ mode: generationMode, width, height });

    jadeCost = getJadeCost({
      mode: generationMode,
      duration: duration_s,
      hasAudioLayer: include_audio,
    });

    console.error("[generate-img2video] START", {
      userId,
      provider,
      generationMode,
      duration_s,
      aspect_ratio,
      has_image_b64: !!image_b64,
      has_image_url: !!image_url,
      imageMimeType,
      fps,
      num_frames,
      steps,
      guidance_scale,
      denoise,
      seed,
      motion_strength,
      requestedAudioLayer,
      include_audio,
      resolution,
      jadeCost,
    });

    ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: jadeCost,
      p_reason: getSpendReason(generationMode, include_audio),
      p_ref: ref,
    });

    if (spendErr) {
      console.error("[generate-img2video] spend_jades failed", spendErr.message);
      return res.status(400).json({
        ok: false,
        error: `Jades spend failed: ${spendErr.message}`,
      });
    }

    jadesCharged = true;

    console.error("[generate-img2video] spend_jades ok", {
      userId,
      jadeCost,
      ref,
    });

    jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      status: "QUEUED",
      mode: "i2v",
      prompt: resolvedPrompt,
      negative_prompt: resolvedNegative || "",
      width,
      height,
      fps,
      num_frames,
      steps,
      guidance_scale,
      payload: {
        ...(body || {}),
        generation_mode: generationMode,
        include_audio,
        requested_audio_layer: requestedAudioLayer,
        resolved_duration_s: duration_s,
        resolved_resolution: resolution,
      },
      provider,
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);

    if (insErr) {
      console.error("[generate-img2video] video_jobs insert failed", insErr.message);

      await refundJadesSafe({
        userId,
        amount: jadeCost,
        ref,
        reason: "i2v_insert_failed",
      });

      return res.status(400).json({
        ok: false,
        error: `video_jobs insert failed: ${insErr.message}`,
      });
    }

    console.error("[generate-img2video] video_jobs insert ok", {
      jobId,
      provider,
      generationMode,
    });

    let providerRequestId = null;
    let startedAtIso = null;

    if (generationMode === "express") {
      console.error("[generate-img2video] EXPRESS MODE START", {
        userId,
        jobId,
        has_image_b64: !!image_b64,
        has_image_url: !!image_url,
        imageMimeType,
        aspect_ratio,
        duration_s,
        include_audio,
      });

      if (!image_b64) {
        throw new Error("Express mode requires image_b64. Do not send only image_url for Veo.");
      }

      const veoResult = await generateVeoVideo({
        prompt: resolvedPrompt,
        imageB64: image_b64,
        imageMimeType,
        aspectRatio: aspect_ratio,
        durationSeconds: duration_s,
      });

      console.error("[generate-img2video] veoResult:", JSON.stringify(veoResult));

      providerRequestId =
        veoResult?.name ||
        veoResult?.id ||
        veoResult?.operationName ||
        null;

      if (!providerRequestId) {
        throw new Error("Veo did not return an operation name");
      }

      startedAtIso = new Date().toISOString();

      const { error: updErr } = await supabaseAdmin
        .from("video_jobs")
        .update({
          provider_request_id: String(providerRequestId),
          provider_status: "submitted",
          provider_raw: veoResult,
          status: "IN_PROGRESS",
          started_at: startedAtIso,
        })
        .eq("id", jobId);

      if (updErr) {
        throw new Error(`video_jobs update failed after Veo submit: ${updErr.message}`);
      }

      return res.status(200).json({
        ok: true,
        job_id: jobId,
        provider: "google_veo",
        provider_request_id: providerRequestId,
        started_at: startedAtIso,
        jade_spent: jadeCost,
        generation_mode: "express",
        include_audio,
      });
    }

    if (generationMode === "standard") {
      console.error("[generate-img2video] STANDARD MODE START", {
        jobId,
        duration_s,
        aspect_ratio,
        resolution,
        include_audio,
      });

      const falImageUrl = toFalImageUrl({
        image_b64,
        image_url,
        imageMimeType,
      });

      if (!falImageUrl) {
        throw new Error("Standard mode requires image_url or image_b64");
      }

      const falInput = {
        prompt: resolvedPrompt,
        image_url: falImageUrl,
        negative_prompt: resolvedNegative || "",
        resolution: resolution || "1080p",
        duration: String(duration_s),
        enable_prompt_expansion: true,
        multi_shots: false,
        enable_safety_checker: true,
        seed,
      };

      const falResp = await falQueueSubmit({ input: falInput });

      console.error("[generate-img2video] fal response:", JSON.stringify(falResp));

      providerRequestId =
        falResp?.request_id ||
        falResp?.requestId ||
        falResp?.id ||
        null;

      if (!providerRequestId) {
        throw new Error("fal did not return a request id");
      }

      startedAtIso = new Date().toISOString();

      const { error: updErr } = await supabaseAdmin
        .from("video_jobs")
        .update({
          provider_request_id: String(providerRequestId),
          provider_status: "submitted",
          provider_raw: falResp,
          status: "IN_PROGRESS",
          started_at: startedAtIso,
        })
        .eq("id", jobId);

      if (updErr) {
        throw new Error(`video_jobs update failed after fal submit: ${updErr.message}`);
      }

      return res.status(200).json({
        ok: true,
        job_id: jobId,
        provider: "fal_wan_flash",
        provider_request_id: providerRequestId,
        started_at: startedAtIso,
        jade_spent: jadeCost,
        generation_mode: "standard",
        include_audio,
      });
    }

    const endpointId = pickI2VEndpointId();

    console.error("[generate-img2video] STUDIO MODE START", {
      endpointId,
      jobId,
      duration_s,
      aspect_ratio,
      include_audio,
    });

    const rpInput = {
      mode: "i2v",
      job_id: jobId,
      user_id: userId,
      prompt: resolvedPrompt,
      negative_prompt: resolvedNegative || "",
      fps,
      num_frames,
      steps,
      guidance_scale,
      denoise,
      seed,
      motion_strength,
      duration_s,
      ...(aspect_ratio ? { aspect_ratio } : {}),
      width,
      height,
      image_b64,
      image_url,
    };

    const rp = await runpodRun({ endpointId, input: rpInput });

    console.error("[generate-img2video] runpod response:", JSON.stringify(rp));

    providerRequestId = rp?.id || rp?.jobId || rp?.request_id || null;

    if (!providerRequestId) {
      throw new Error("RunPod did not return a request id");
    }

    startedAtIso = new Date().toISOString();

    const { error: updErr } = await supabaseAdmin
      .from("video_jobs")
      .update({
        provider_request_id: String(providerRequestId),
        provider_status: "submitted",
        provider_raw: rp,
        status: "IN_PROGRESS",
        started_at: startedAtIso,
      })
      .eq("id", jobId);

    if (updErr) {
      throw new Error(`video_jobs update failed after RunPod submit: ${updErr.message}`);
    }

    return res.status(200).json({
      ok: true,
      job_id: jobId,
      provider: "runpod",
      provider_request_id: providerRequestId,
      started_at: startedAtIso,
      jade_spent: jadeCost,
      generation_mode: "studio",
      include_audio: false,
    });
  } catch (e) {
    console.error("[generate-img2video] ERROR:", {
      message: e?.message || "Server error",
      stack: e?.stack || null,
      userId,
      jobId,
      jadeCost,
      jadesCharged,
      ref,
    });

    if (jobId) {
      try {
        const { error: failUpdErr } = await supabaseAdmin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "failed",
            provider_error: e?.message || "Server error",
            error: e?.message || "Server error",
          })
          .eq("id", jobId);

        if (failUpdErr) {
          console.error(
            "[generate-img2video] FAILED updating video_jobs:",
            failUpdErr?.message || failUpdErr
          );
        }
      } catch (innerErr) {
        console.error(
          "[generate-img2video] FAILED updating video_jobs exception:",
          innerErr?.message || innerErr
        );
      }
    }

    if (jadesCharged && userId && jadeCost > 0 && ref) {
      await refundJadesSafe({
        userId,
        amount: jadeCost,
        ref,
        reason: "i2v_generation_failed",
      });
    }

    return res.status(500).json({
      ok: false,
      error: e?.message || "Server error",
    });
  }
}
