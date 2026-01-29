// api/generate-img2video.js
// ------------------------------------------------------------
// generate-img2video (I2V)
// - AUTH: getUserIdFromAuthHeader (same as generate-video.js)
// - Billing: server-side via spend_jades (like generate-video.js)
// - Creates job in video_jobs
// - Dispatches RunPod serverless endpoint
// - FIX1: Worker REQUIRES prompt -> provide default prompt if empty
// - FIX2: Defaults aligned with POD template to avoid OOM
//         (576x1024, 73 frames, steps 18, guidance 6.0, fps 24)
// - FIX3: Provide default negative if empty
// ------------------------------------------------------------

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

// ✅ Defaults como tu template del pod
const DEFAULT_W = Number(process.env.DEFAULT_W || 576);
const DEFAULT_H = Number(process.env.DEFAULT_H || 1024);
const DEFAULT_FRAMES = Number(process.env.DEFAULT_FRAMES || 73); // tu pod: 73
const DEFAULT_STEPS = Number(process.env.DEFAULT_STEPS || 18); // tu pod: 18
const DEFAULT_GUIDANCE = Number(process.env.DEFAULT_GUIDANCE || 6.0); // tu pod: 6.0
const DEFAULT_FPS = Number(process.env.DEFAULT_FPS || 24);

// (opcional si querés clamps como en template)
const MAX_FRAMES = Number(process.env.MAX_FRAMES || 75);
const MAX_STEPS = Number(process.env.MAX_STEPS || 25);

function pickI2VEndpointId() {
  return (
    process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.VIDEO_RUNPOD_ENDPOINT ||
    null
  );
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

  return data; // { id: "..." }
}

// ------------------------------------------------------------
// ✅ Prompt default (porque el worker lo exige)
// ------------------------------------------------------------
function defaultI2VPrompt() {
  return (
    "Smooth natural motion, subtle camera movement, cinematic lighting, stable anatomy, " +
    "high detail, sharp focus, clean edges, realistic textures, no flicker, no jitter"
  );
}

// ------------------------------------------------------------
// ✅ Negative default (si el usuario no manda negative)
// ------------------------------------------------------------
function defaultNegativePrompt() {
  return (
    "blurry, low quality, worst quality, lowres, pixelated, deformed, bad anatomy, distorted face, " +
    "extra limbs, missing fingers, fused fingers, broken hands, warped objects, " +
    "flicker, jitter, frame tearing, unstable motion, ghosting, duplicate subject, " +
    "watermark, text, logo, subtitles"
  );
}

// clamps suaves para evitar que se pasen y reviente VRAM
function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // ✅ prompt: si viene vacío, worker revienta -> fallback
    const rawPrompt = String(body?.prompt || "").trim();
    const prompt = rawPrompt.length > 0 ? rawPrompt : defaultI2VPrompt();

    // ✅ negative: si viene vacío, mete default
    const negativeRaw = String(body?.negative_prompt || body?.negative || "").trim();
    const negative_prompt = negativeRaw.length > 0 ? negativeRaw : defaultNegativePrompt();

    // Aspect ratio opcional (solo "9:16" si viene)
    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" o "9:16"

    // Timing
    const fps = Number(body?.fps || DEFAULT_FPS);

    // Si el frontend manda seconds/duration_s usamos eso,
    // pero el POD se controlaba realmente por frames (73)
    const seconds =
      body?.duration_s !== undefined && body?.duration_s !== null && body?.duration_s !== ""
        ? Number(body.duration_s)
        : body?.seconds !== undefined && body?.seconds !== null && body?.seconds !== ""
        ? Number(body.seconds)
        : null;

    // Frames: si viene num_frames/frames úsalo, si no -> DEFAULT_FRAMES (73)
    let num_frames =
      body?.num_frames !== undefined && body?.num_frames !== null && body?.num_frames !== ""
        ? Number(body.num_frames)
        : body?.frames !== undefined && body?.frames !== null && body?.frames !== ""
        ? Number(body.frames)
        : null;

    if (!Number.isFinite(num_frames) && Number.isFinite(seconds)) {
      num_frames = Math.round(fps * seconds);
    }
    if (!Number.isFinite(num_frames)) num_frames = DEFAULT_FRAMES;

    // ✅ clamps: como tu template MAX_FRAMES 75
    num_frames = clampInt(num_frames, 8, MAX_FRAMES, DEFAULT_FRAMES);

    // Calidad defaults como tu template
    const steps = clampInt(body?.steps ?? DEFAULT_STEPS, 5, MAX_STEPS, DEFAULT_STEPS);
    const guidance_scale = Number(
      body?.guidance_scale !== undefined && body?.guidance_scale !== null && body?.guidance_scale !== ""
        ? body.guidance_scale
        : DEFAULT_GUIDANCE
    );

    // ✅ width/height (si no vienen, usamos defaults del POD)
    const width =
      body?.width !== undefined && body?.width !== null && body?.width !== "" ? Number(body.width) : DEFAULT_W;
    const height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : DEFAULT_H;

    // Image input
    const image_b64 = body?.image_b64 ? String(body.image_b64) : null;
    const image_url = body?.image_url ? String(body.image_url).trim() : null;

    if (!image_b64 && !image_url) {
      return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });
    }

    // ✅ 1) cobrar jades
    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 12, // tu precio actual I2V
      p_reason: "i2v_generate",
      p_ref: ref,
    });

    if (spendErr) {
      return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });
    }

    // ✅ 2) crear job en video_jobs
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      status: "QUEUED",
      mode: "i2v",

      prompt,
      negative_prompt,

      // (si tu schema tiene width/height para i2v y querés guardarlo, lo agregás)
      width,
      height,

      fps,
      num_frames,
      steps,
      guidance_scale,

      payload: body ? JSON.stringify(body) : null,
      provider: "runpod",
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);
    if (insErr) {
      return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ 3) RunPod dispatch
    const endpointId = pickI2VEndpointId();

    const rpInput = {
      mode: "i2v",
      job_id: jobId,
      user_id: userId,

      prompt,
      negative_prompt,

      // ✅ IMPORTANTES para consistencia con POD
      width,
      height,
      fps,
      num_frames,
      steps,
      guidance_scale,

      ...(Number.isFinite(seconds) ? { duration_s: seconds } : {}), // solo si existe
      ...(aspect_ratio ? { aspect_ratio } : {}),

      image_b64,
      image_url,
    };

    const rp = await runpodRun({ endpointId, input: rpInput });

    const runpodId = rp?.id || rp?.jobId || rp?.request_id || null;

    if (runpodId) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          provider_request_id: String(runpodId),
          provider_status: "submitted",
          status: "IN_PROGRESS",
          started_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    return res.status(200).json({
      ok: true,
      job_id: jobId,
      provider_request_id: runpodId,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}