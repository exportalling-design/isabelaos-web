// api/generate-video.js
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
    process.env.RP_WAN22_T2V_ENDPOINT ||          // tu env visible en screenshot
    process.env.VIDEO_RUNPOD_ENDPOINT_ID ||       // si lo usas como fallback
    process.env.VIDEO_RUNPOD_ENDPOINT ||          // por si existe en tu proyecto
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

  return data; // { id: "..." } normalmente
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ user id desde tu helper
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const prompt = String(body?.prompt || "").trim();
    const negative_prompt = String(body?.negative || body?.negative_prompt || "").trim(); // ✅ mapea "negative" -> negative_prompt

    const width = Number(body?.width || 1080);
    const height = Number(body?.height || 1920);

    const fps = Number(body?.fps || 24);
    const seconds = Number(body?.seconds || 3);

    // ✅ tu tabla usa num_frames
    const num_frames = Number(body?.num_frames || body?.frames || Math.round(fps * seconds));

    // opcionales en tu tabla
    const steps = Number(body?.steps || 25);
    const guidance_scale = Number(body?.guidance_scale || 7.5);

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

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

    // ✅ 2) crear job (SOLO columnas que EXISTEN en tu schema)
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      status: "QUEUED",
      mode: "t2v",
      prompt,
      negative_prompt,       // ✅ columna real
      width,
      height,
      fps,
      num_frames,            // ✅ columna real
      steps,
      guidance_scale,
      provider: "runpod",
      payload: body ? JSON.stringify(body) : null, // ✅ existe "payload"
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);
    if (insErr) {
      return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ 3) RunPod
    const endpointId = pickT2VEndpointId();

    const rp = await runpodRun({
      endpointId,
      input: {
        mode: "t2v",
        job_id: jobId,
        user_id: userId,
        prompt,
        negative_prompt,
        width,
        height,
        fps,
        num_frames,
        steps,
        guidance_scale,
      },
    });

    const runpodId = rp?.id || rp?.jobId || rp?.request_id || null;

    if (runpodId) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          provider_request_id: String(runpodId), // ✅ columna real
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