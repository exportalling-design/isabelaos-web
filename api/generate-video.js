// api/generate-video.js  (WAN Serverless)
// - Defaults alineados al worker WAN:
//   fps=16, duration_s=3/5, num_frames WAN (49/81),
//   default size = 576x512, reels 9:16 = 576x1024
// - Prompt: siempre fuerza encuadre centrado (evita ojos-only / fuera de cuadro)

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

function pickT2VEndpointId() {
  return (
    process.env.RP_WAN22_T2V_ENDPOINT ||
    process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.VIDEO_RUNPOD_ENDPOINT ||
    null
  );
}

async function runpodRun({ endpointId, input }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing T2V endpoint id env var");

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

// ------------------------------------------------------------
// ✅ COMPOSICIÓN FORZADA (solo encuadre, no cambia el concepto)
// ------------------------------------------------------------
const COMPOSITION_SUFFIX =
  " | centered subject, stable framing, head and shoulders, medium shot, " +
  "subject fully in frame, face fully visible, looking at camera, " +
  "no extreme close-up, no partial face";

// ------------------------------------------------------------
// ✅ PROMPTS DEFAULT (ultradetalle + hiperrealismo + encuadre centrado)
// ------------------------------------------------------------
const DEFAULT_PROMPT =
  "ultra detailed, hyperrealistic, photorealistic, cinematic lighting, " +
  "sharp focus, high dynamic range, realistic skin texture, natural colors, " +
  "high quality, professional video, film look, " +
  "portrait of a beautiful woman, centered, medium shot, head and shoulders, " +
  "face fully visible, subject fully in frame, looking at camera";

const DEFAULT_NEGATIVE =
  "low quality, blurry, noisy, jpeg artifacts, deformed, distorted, " +
  "extra limbs, bad anatomy, out of frame, cropped, cut off, " +
  "cut off head, cut off face, partial face, extreme close-up, " +
  "text, watermark, logo";

// ------------------------------------------------------------
// ✅ pickFinalPrompts
// - Luego SIEMPRE aplica COMPOSITION_SUFFIX
// ------------------------------------------------------------
function pickFinalPrompts(body) {
  const b = body || {};

  const basePrompt =
    String(b?.finalPrompt || "").trim() ||
    String(b?.optimizedPrompt || "").trim() ||
    String(b?.prompt || "").trim() ||
    DEFAULT_PROMPT;

  const baseNegative =
    String(b?.finalNegative || "").trim() ||
    String(b?.optimizedNegative || "").trim() ||
    String(b?.negative_prompt || b?.negative || "").trim() ||
    DEFAULT_NEGATIVE;

  // ✅ aplica composición SIEMPRE (aunque venga prompt del user)
  const finalPrompt = `${basePrompt}${COMPOSITION_SUFFIX}`;

  // ✅ refuerza negativos aunque el user mande negativos flojos
  // (sin romper si ya trae algo)
  const finalNegative = baseNegative
    ? `${baseNegative}, out of frame, cropped, cut off head, cut off face, partial face, extreme close-up`
    : DEFAULT_NEGATIVE;

  const usedDefault = !(
    String(b?.finalPrompt || "").trim() ||
    String(b?.optimizedPrompt || "").trim() ||
    String(b?.prompt || "").trim()
  );

  return { finalPrompt, finalNegative, usedDefault };
}

// ------------------------------------------------------------
// ✅ WAN helpers: timing + frames
// ------------------------------------------------------------
function clampInt(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const r = Math.round(n);
  return Math.max(lo, Math.min(hi, r));
}

function clampFloat(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

function fixFramesForWan(numFrames) {
  let nf = Math.max(5, Math.round(Number(numFrames) || 0));
  const r = (nf - 1) % 4;
  if (r === 0) return nf;
  return nf + (4 - r);
}

function normalizeDurationSeconds(body) {
  const raw = body?.duration_s ?? body?.seconds ?? null;
  let s = raw === null || raw === undefined || raw === "" ? 3 : Number(raw);
  if (!Number.isFinite(s)) s = 3;
  s = clampInt(s, 3, 5, 3);
  return s < 4 ? 3 : 5;
}

// ✅ default = mujer nieve (576x512), reels = 576x1024
function pickDims(body) {
  const ar = String(body?.aspect_ratio || "").trim();
  if (ar === "9:16") return { width: 576, height: 1024 };
  return { width: 576, height: 512 };
}

function pickSeed(body) {
  const s = body?.seed;
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return Math.floor(Date.now() % 2147483647);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { finalPrompt, finalNegative, usedDefault } = pickFinalPrompts(body);

    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" o "9:16"

    // ✅ aligned defaults
    const seconds = normalizeDurationSeconds(body);
    const fps = clampInt(body?.fps ?? 16, 8, 30, 16);

    const requestedFrames = body?.num_frames ?? body?.frames ?? body?.numFrames ?? null;

    // ✅ WAN frames => 49/81 (y siempre (n-1)%4==0)
    const num_frames = fixFramesForWan(
      requestedFrames !== null && requestedFrames !== undefined && requestedFrames !== ""
        ? Number(requestedFrames)
        : seconds * fps
    );

    const steps = clampInt(body?.steps ?? 18, 1, 80, 18);
    const guidance_scale = clampFloat(body?.guidance_scale ?? 5.0, 1.0, 10.0, 5.0);

    // ✅ optional extras (worker may ignore if not supported)
    const seed = pickSeed(body);
    const strength = clampFloat(body?.strength ?? body?.denoise ?? 0.65, 0.1, 1.0, 0.65);
    const motion_strength = clampFloat(body?.motion_strength ?? 1.0, 0.1, 2.0, 1.0);

    const dims = pickDims(body);

    const width =
      body?.width !== undefined && body?.width !== null && body?.width !== ""
        ? Number(body.width)
        : dims.width;

    const height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : dims.height;

    // ✅ 1) cobrar jades
    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { data: spendData, error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 10,
      p_reason: "t2v_generate",
      p_ref: ref,
    });

    if (spendErr) {
      return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });
    }

    // ✅ 2) crear job
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      status: "QUEUED",
      mode: "t2v",
      prompt: finalPrompt,
      negative_prompt: finalNegative || "",

      width,
      height,

      fps,
      num_frames,
      steps,
      guidance_scale,
      provider: "runpod",
      payload: body ? JSON.stringify(body) : null,
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);
    if (insErr) {
      return res
        .status(400)
        .json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ 3) RunPod
    const endpointId = pickT2VEndpointId();

    const rpInput = {
      mode: "t2v",
      job_id: jobId,
      user_id: userId,
      prompt: finalPrompt,
      negative_prompt: finalNegative || "",

      duration_s: seconds,
      fps,
      num_frames,
      steps,
      guidance_scale,

      // ✅ optional extras (safe)
      seed,
      strength,
      denoise: strength,
      motion_strength,

      ...(aspect_ratio ? { aspect_ratio } : {}),
      width,
      height,
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
      spend: spendData ?? null,
      used_default_prompt: !!usedDefault,
      resolved_defaults: {
        width,
        height,
        duration_s: seconds,
        fps,
        num_frames,
        steps,
        guidance_scale,
        aspect_ratio: aspect_ratio || "",
        seed,
        strength,
        motion_strength,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}