// /api/generate-img2video.js
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

// ✅ I2V endpoint id (env)
function pickI2VEndpointId() {
  return (
    process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID || // ideal
    process.env.VIDEO_RUNPOD_ENDPOINT_ID || // fallback
    process.env.VIDEO_RUNPOD_ENDPOINT || // fallback
    null
  );
}

async function runpodRun({ endpointId, input }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing IMG2VIDEO endpoint id env var");

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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ igual que generate-video
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const prompt = String(body?.prompt || "").trim();
    const negative_prompt = String(body?.negative || body?.negative_prompt || "").trim();

    // imagen requerida
    const image_b64 = body?.image_b64 || null;
    const image_url = String(body?.image_url || "").trim() || null;

    if (!image_b64 && !image_url) {
      return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });
    }

    // timing como t2v
    const fps = Number(body?.fps || 24);
    const seconds = Number(body?.duration_s || body?.seconds || 3);
    const num_frames = Number(body?.num_frames || body?.frames || Math.round(fps * seconds));

    const steps = Number(body?.steps || 25);
    const guidance_scale = Number(body?.guidance_scale || 7.5);

    // aspect ratio como t2v
    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" o "9:16"

    // width/height opcionales (si no vienen => null, worker decide)
    const width =
      body?.width !== undefined && body?.width !== null && body?.width !== ""
        ? Number(body.width)
        : null;

    const height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : null;

    // si querés permitir prompt vacío ok, pero si querés exigirlo:
    // if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // ✅ cobro (igual que generate-video) pero solo si ya no lo cobraste en frontend
    const alreadyBilled = body?.already_billed === true;

    if (!alreadyBilled) {
      const ref = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

      const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
        p_user_id: userId,
        p_amount: 12,
        p_reason: "img2video_generate",
        p_ref: ref,
      });

      if (spendErr) {
        return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });
      }
    }

    // ✅ crear job (igual estructura que generate-video)
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
      width: width ?? null,
      height: height ?? null,
      fps,
      num_frames,
      steps,
      guidance_scale,
      provider: "runpod",
      payload: body ? JSON.stringify(body) : null,
      video_url: null,
      error: null,
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);
    if (insErr) {
      return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ RunPod input (igual patrón que t2v)
    const endpointId = pickI2VEndpointId();

    const rpInput = {
      mode: "i2v",
      job_id: jobId,
      user_id: userId,
      prompt,
      negative_prompt,
      fps,
      num_frames,
      steps,
      guidance_scale,
      duration_s: seconds,

      // imagen
      image_b64,
      image_url,

      ...(aspect_ratio ? { aspect_ratio } : {}),
      ...(typeof width === "number" && Number.isFinite(width) ? { width } : {}),
      ...(typeof height === "number" && Number.isFinite(height) ? { height } : {}),
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