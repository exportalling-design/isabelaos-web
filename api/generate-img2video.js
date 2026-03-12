import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";
import { generateVeoVideo } from "../src/lib/veo.js";

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

  return { finalPrompt, finalNegative };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (x) => Number.isFinite(Number(x));

function normalizeDuration(raw) {
  const n = Number(raw);
  if (n === 5) return 5;
  return 8;
}

function getJadeCost({ isFastMode, duration }) {
  if (isFastMode) {
    if (duration === 5) return 12;
    return 15; // 8s Fast
  }

  if (duration === 5) return 11;
  return 12; // 8s Pro
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
      console.error("refund_jades failed:", error.message);
    }
  } catch (e) {
    console.error("refund_jades exception:", e?.message || e);
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

    const isFastMode = !!body?.is_fast_mode;
    const provider = isFastMode ? "google_veo" : "runpod";

    const aspect_ratio = String(body?.aspect_ratio || "").trim() || "9:16";
    const duration_s = normalizeDuration(body?.duration_s ?? body?.seconds ?? 8);

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

    jadeCost = getJadeCost({ isFastMode, duration: duration_s });

    ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: jadeCost,
      p_reason: isFastMode ? "i2v_generate_fast" : "i2v_generate_pro",
      p_ref: ref,
    });

    if (spendErr) {
      return res.status(400).json({
        ok: false,
        error: `Jades spend failed: ${spendErr.message}`,
      });
    }

    jadesCharged = true;

    jobId = globalThis.crypto?.randomUUID
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
      payload: body || null,
      provider,
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);

    if (insErr) {
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

    let providerRequestId = null;
    let startedAtIso = null;

    if (isFastMode) {
      const veoResult = await generateVeoVideo({
        prompt: finalPrompt,
        imageUrl: image_url || image_b64,
        aspectRatio: aspect_ratio,
        durationSeconds: duration_s,
      });

      providerRequestId =
        veoResult?.name ||
        veoResult?.id ||
        veoResult?.operationName ||
        null;

      if (!providerRequestId) {
        throw new Error("Veo did not return an operation name");
      }

      startedAtIso = new Date().toISOString();

      await supabaseAdmin
        .from("video_jobs")
        .update({
          provider_request_id: String(providerRequestId),
          provider_status: "submitted",
          provider_raw: veoResult,
          status: "IN_PROGRESS",
          started_at: startedAtIso,
        })
        .eq("id", jobId);

      return res.status(200).json({
        ok: true,
        job_id: jobId,
        provider: "google_veo",
        provider_request_id: providerRequestId,
        started_at: startedAtIso,
        jade_spent: jadeCost,
        mode: "FAST",
      });
    }

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
    providerRequestId = rp?.id || rp?.jobId || rp?.request_id || null;

    if (providerRequestId) {
      startedAtIso = new Date().toISOString();

      await supabaseAdmin
        .from("video_jobs")
        .update({
          provider_request_id: String(providerRequestId),
          provider_status: "submitted",
          provider_raw: rp,
          status: "IN_PROGRESS",
          started_at: startedAtIso,
        })
        .eq("id", jobId);
    }

    return res.status(200).json({
      ok: true,
      job_id: jobId,
      provider: "runpod",
      provider_request_id: providerRequestId,
      started_at: startedAtIso,
      jade_spent: jadeCost,
      mode: "PRO",
    });
  } catch (e) {
    if (jobId) {
      try {
        await supabaseAdmin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "failed",
            provider_error: e?.message || "Server error",
            error: e?.message || "Server error",
          })
          .eq("id", jobId);
      } catch (_) {}
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
