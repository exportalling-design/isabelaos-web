// api/generate-img2video.js
// ------------------------------------------------------------
// generate-img2video (I2V)
// - AUTH: getUserIdFromAuthHeader (same as generate-video.js)
// - Billing: server-side via spend_jades (like generate-video.js)
// - Creates job in video_jobs
// - Dispatches RunPod serverless endpoint
// ------------------------------------------------------------

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

// ✅ I2V endpoint id (Vercel env)
// Prefer IMG2VIDEO_RUNPOD_ENDPOINT_ID if you set it, else fall back to VIDEO_RUNPOD_ENDPOINT_ID
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

  return data; // usually { id: "..." }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ user id from same helper used in generate-video.js
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const prompt = String(body?.prompt || "").trim();
    const negative_prompt = String(body?.negative_prompt || body?.negative || "").trim();

    // Aspect ratio optional ("9:16" only if checked)
    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" or "9:16"

    // Timing
    const fps = Number(body?.fps || 24);
    const seconds = Number(body?.duration_s || body?.seconds || 3);
    const num_frames = Number(body?.num_frames || body?.frames || Math.round(fps * seconds));

    const steps = Number(body?.steps || 25);
    const guidance_scale = Number(body?.guidance_scale || 7.5);

    // Image input
    const image_b64 = body?.image_b64 ? String(body.image_b64) : null;
    const image_url = body?.image_url ? String(body.image_url).trim() : null;

    if (!image_b64 && !image_url) {
      return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });
    }

    // prompt is optional for i2v (allow empty), but keep it as string
    // if you want to require it, uncomment:
    // if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // ✅ 1) spend jades (server-side)
    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 12, // change if you want a different I2V price
      p_reason: "i2v_generate",
      p_ref: ref,
    });

    if (spendErr) {
      return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });
    }

    // ✅ 2) create job in video_jobs (same style as generate-video.js)
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      status: "QUEUED",
      mode: "i2v",

      prompt: prompt || "",
      negative_prompt: negative_prompt || "",

      fps,
      num_frames,
      steps,
      guidance_scale,

      // optional storage (keep payload like T2V)
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

      prompt: prompt || "",
      negative_prompt: negative_prompt || "",

      fps,
      num_frames,
      steps,
      guidance_scale,

      duration_s: seconds,

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