// api/generate-img2video.js (UPDATED - NO DB CHANGES)
// - Mantiene cobro de jades igual (12)
// - NO inserta columnas nuevas en video_jobs (evita error schema cache)
// - Sí manda denoise/seed/motion_strength al worker por rpInput
// - Defaults serverless más estables

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

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

  return data;
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

  const usingOptimized = !!(
    (String(b?.finalPrompt || "").trim() || String(b?.optimizedPrompt || "").trim()) &&
    finalPrompt
  );

  return { finalPrompt, finalNegative, usingOptimized };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (x) => Number.isFinite(Number(x));

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

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

    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" o "9:16"

    // Defaults serverless (frontend puede override)
    const fps = Number(body?.fps ?? 16);
    const num_frames = Number(body?.num_frames ?? body?.frames ?? 48);
    const steps = Number(body?.steps ?? 18);

    // guidance (acepta cfg alias)
    const guidance_scale_raw = body?.guidance_scale ?? body?.cfg ?? 5.0;
    const guidance_scale = clamp(Number(guidance_scale_raw), 1.0, 10.0);

    // estabilidad I2V (se envía al worker; NO se guarda en DB)
    const denoise_raw = body?.denoise ?? body?.strength ?? 0.45;
    const denoise = clamp(Number(denoise_raw), 0.2, 0.8);

    const seed = isNum(body?.seed) ? Number(body.seed) : 12345;

    const motion_strength_raw = body?.motion_strength ?? 0.6;
    const motion_strength = clamp(Number(motion_strength_raw), 0.1, 1.0);

    // Resolución default estable (respeta overrides)
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

    // ✅ 1) spend jades (IGUAL)
    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 12,
      p_reason: "i2v_generate",
      p_ref: ref,
    });

    if (spendErr) {
      return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });
    }

    // ✅ 2) create job (SIN columnas nuevas)
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      status: "QUEUED",
      mode: "i2v",
      prompt: finalPrompt,
      negative_prompt: finalNegative || "",

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
      return res
        .status(400)
        .json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ 3) RunPod dispatch
    const endpointId = pickI2VEndpointId();

    const rpInput = {
      mode: "i2v",
      job_id: jobId,
      user_id: userId,
      prompt: finalPrompt,
      negative_prompt: finalNegative || "",

      fps,
      num_frames,
      steps,
      guidance_scale,

      // ✅ estabilidad (worker debe leerlo)
      denoise,
      seed,
      motion_strength,

      duration_s: body?.duration_s ?? body?.seconds ?? null,

      ...(aspect_ratio ? { aspect_ratio } : {}),
      width,
      height,

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