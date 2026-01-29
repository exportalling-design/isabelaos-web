// api/generate-video.js  (CLON POD)
// - Defaults exactos del POD: steps 34, 1280x720, 75 frames, 24 fps, guidance 6.5
// - Usa prompt final (optimizado si viene), SIN inventar prompts
// - Si falta prompt => "Falta prompt" (idéntico a tu versión POD)

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
// ✅ pickFinalPrompts (compatible)
// Prioridad:
// 1) body.finalPrompt / body.finalNegative (si tu frontend los manda)
// 2) body.optimizedPrompt / body.optimizedNegative (si los manda)
// 3) body.prompt / body.negative_prompt|negative
// ------------------------------------------------------------
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // ✅ CLON POD: usar prompt final
    const { finalPrompt, finalNegative } = pickFinalPrompts(body);

    if (!finalPrompt) {
      return res.status(400).json({ ok: false, error: "Falta prompt" });
    }

    // Aspect ratio opcional ("9:16" solo si UI lo manda)
    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" o "9:16"

    // ✅ CLON POD: defaults exactos
    const fps = Number(body?.fps ?? 24);
    const num_frames = Number(body?.num_frames ?? body?.frames ?? 75);
    const steps = Number(body?.steps ?? 34);
    const guidance_scale = Number(body?.guidance_scale ?? 6.5);

    // ✅ CLON POD: resolución exacta si no viene
    const width =
      body?.width !== undefined && body?.width !== null && body?.width !== ""
        ? Number(body.width)
        : 1280;

    const height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : 720;

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

      fps,
      num_frames,
      steps,
      guidance_scale,

      // igual que tu estructura actual (no estorba)
      duration_s: body?.duration_s ?? body?.seconds ?? null,

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
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}