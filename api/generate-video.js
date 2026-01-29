// /api/generate-video.js
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

// ✅ T2V endpoint id (Vercel env)
function pickT2VEndpointId() {
  return (
    process.env.RP_WAN22_T2V_ENDPOINT ||
    process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.VIDEO_RUNPOD_ENDPOINT ||
    null
  );
}

// ✅ Auto quality prompt (lens/light/clarity) - universal
function enrichPrompt(userPrompt) {
  const base =
    "cinematic shot, sharp focus, ultra detailed, clean edges, professional color grading, HDR, " +
    "35mm lens, f/2.8, soft key light, rim light, realistic textures, natural skin detail, " +
    "stable motion, high shutter clarity, high fidelity";
  const p = String(userPrompt || "").trim();
  return `${base}. ${p}`.trim();
}

function enrichNegative(userNegative) {
  const baseNeg =
    "blurry, low quality, lowres, noise, jpeg artifacts, watermark, text, logo, " +
    "deformed, bad anatomy, extra limbs, face distortion, flicker, jitter, warping, " +
    "ghosting, duplicate subject, oversmooth, plastic skin";
  const n = String(userNegative || "").trim();
  return n ? `${baseNeg}, ${n}` : baseNeg;
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const userPrompt = String(body?.prompt || "").trim();
    const userNeg = String(body?.negative || body?.negative_prompt || "").trim();

    if (!userPrompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // ✅ Always enhance
    const prompt = enrichPrompt(userPrompt);
    const negative_prompt = enrichNegative(userNeg);

    // Optional ratio
    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" or "9:16"

    // ✅ POD-LIKE DEFAULTS (what you showed worked)
    const fps = Number(body?.fps || 24);

    // If frontend sends duration_s, fine, but we primarily follow frames.
    const seconds = Number(body?.duration_s || body?.seconds || 3);

    // ✅ Prefer explicit num_frames, else default to 73 (pod)
    const num_frames =
      body?.num_frames !== undefined && body?.num_frames !== null && body?.num_frames !== ""
        ? Number(body.num_frames)
        : 73;

    // ✅ Match pod defaults
    const steps = Number(body?.steps || 18);
    const guidance_scale = Number(body?.guidance_scale || 6.0);

    // ✅ Force res (pod): 576x1024 (unless user explicitly sets it)
    const width =
      body?.width !== undefined && body?.width !== null && body?.width !== ""
        ? Number(body.width)
        : 576;

    const height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : 1024;

    // ✅ Spend jades
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

    // ✅ Create job
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      status: "QUEUED",
      mode: "t2v",
      prompt, // enhanced prompt saved
      negative_prompt, // enhanced negative saved
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
      return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ RunPod
    const endpointId = pickT2VEndpointId();

    const rpInput = {
      mode: "t2v",
      job_id: jobId,
      user_id: userId,
      prompt,
      negative_prompt,
      fps,
      num_frames,
      steps,
      guidance_scale,
      width,
      height,
      duration_s: seconds,
      ...(aspect_ratio ? { aspect_ratio } : {}),
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
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}