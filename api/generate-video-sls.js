// /api/generate-video-sls.js
// ------------------------------------------------------------
// RunPod Serverless: Text-to-Video (WAN2.2 T2V)
// ✅ PATCH:
// - Acepta nombres nuevos desde el frontend:
//   prompt, negative_prompt, duration_s, num_frames, aspect_ratio, platform_ref, already_billed
// - Mantiene compatibilidad con lo viejo:
//   negative, seconds, fps, seed, width, height
// - Resuelve width/height automáticamente por preset/plataforma si no vienen
// - Calcula num_frames si no viene (duration_s * fps)
// - Limita duración a 3s o 5s (por tu regla actual)
// ------------------------------------------------------------

import { runpodServerlessRun } from "./runpod-sls-client.js";

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.round(n);
  return Math.max(min, Math.min(max, i));
}

function pickDims({ width, height, aspect_ratio, platform_ref }) {
  // 1) Si vienen width/height, se respetan
  const w = Number(width);
  const h = Number(height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: Math.round(w), height: Math.round(h) };
  }

  // 2) Si viene aspect_ratio explícito
  const ar = String(aspect_ratio || "").trim();
  if (ar === "9:16") return { width: 1080, height: 1920 };
  if (ar === "1:1") return { width: 1080, height: 1080 };
  if (ar === "16:9") return { width: 1920, height: 1080 };
  if (ar === "4:5") return { width: 1080, height: 1350 };
  if (ar === "4:3") return { width: 1440, height: 1080 };

  // 3) Si viene platform_ref, usamos defaults razonables
  const p = String(platform_ref || "").toLowerCase().trim();
  if (p === "tiktok") return { width: 1080, height: 1920 };
  if (p === "instagram") return { width: 1080, height: 1920 }; // Reels default vertical
  if (p === "youtube") return { width: 1920, height: 1080 };
  if (p === "facebook") return { width: 1440, height: 1080 };

  // 4) Fallback (tu valor anterior)
  return { width: 768, height: 432 };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const apiKey = process.env.RUNPOD_SLS_API_KEY;
    const endpointId = process.env.RUNPOD_WAN22_T2V_ENDPOINT_ID;

    if (!apiKey) return res.status(500).json({ error: "Missing RUNPOD_SLS_API_KEY" });
    if (!endpointId) return res.status(500).json({ error: "Missing RUNPOD_WAN22_T2V_ENDPOINT_ID" });

    const body = req.body || {};

    // ✅ Prompt requerido
    const prompt = body.prompt;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    // ✅ Negative (compat: negative_prompt o negative)
    const negative =
      (typeof body.negative_prompt === "string" ? body.negative_prompt : null) ??
      (typeof body.negative === "string" ? body.negative : "") ??
      "";

    // ✅ Duración: soporta duration_s o seconds
    // Regla tuya: solo 3s o 5s por ahora (clamp 3..5)
    // Si mandan 4, lo forzamos a 3 (más seguro / barato) o a 5; aquí lo redondeamos y clamp.
    let secondsRaw = body.duration_s ?? body.seconds ?? 4;
    let seconds = clampInt(secondsRaw, 3, 5, 3);
    // Si quieres estrictamente SOLO 3 o 5:
    if (seconds !== 3 && seconds !== 5) seconds = seconds < 4 ? 3 : 5;

    // ✅ FPS: soporta fps, default 24 (tu UI usa 24)
    const fps = clampInt(body.fps ?? 24, 8, 60, 24);

    // ✅ Frames: soporta num_frames, si no lo calculamos
    const numFrames = clampInt(body.num_frames ?? (seconds * fps), 1, 9999, seconds * fps);

    // ✅ Seed
    const seed =
      Number.isFinite(Number(body.seed)) ? Math.round(Number(body.seed)) : -1;

    // ✅ Formato / dims
    const { width, height } = pickDims({
      width: body.width,
      height: body.height,
      aspect_ratio: body.aspect_ratio,
      platform_ref: body.platform_ref,
    });

    // Input que le mandas al worker (manteniendo tus keys existentes)
    // OJO: aquí dejo seconds/fps/width/height como antes, y agrego num_frames/aspect/platform.
    const input = {
      mode: "t2v",
      prompt: prompt.trim(),
      negative: negative || "",

      // Duración
      seconds,
      fps,
      num_frames: numFrames,

      // Calidad / tamaño
      width,
      height,
      aspect_ratio: body.aspect_ratio || null,
      platform_ref: body.platform_ref || null,

      // Seed
      seed,

      // Flags (no rompen si tu worker los ignora)
      already_billed: !!body.already_billed,
      used_optimized: !!body.used_optimized,
    };

    const rp = await runpodServerlessRun({ endpointId, apiKey, input });

    // rp típicamente devuelve { id, status: "IN_QUEUE" ... }
    return res.status(200).json({
      ok: true,
      serverless: true,
      requestId: rp?.id || rp?.requestId || null,
      raw: rp,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}
