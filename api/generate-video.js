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
    process.env.RP_WAN22_T2V_ENDPOINT || // tu env visible en screenshot
    process.env.VIDEO_RUNPOD_ENDPOINT_ID || // fallback
    process.env.VIDEO_RUNPOD_ENDPOINT || // fallback
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

// ------------------------------------------------------------
// ✅ Prompt Enhancer (calidad / lente / luz / enfoque)
// - Si el prompt ya viene largo/detallado, NO lo toca.
// - Si viene corto, lo completa con "cinematic capture" genérico.
// ------------------------------------------------------------
function enhancePromptIfNeeded(userPrompt) {
  const p = String(userPrompt || "").trim();
  if (!p) return "";

  // Si ya viene detallado, no lo tocamos
  if (p.length >= 80) return p;

  // Pack universal (sirve para personas/objetos/agua/productos/escenas)
  const cinematicPack =
    "cinematic professional shot, ultra sharp focus, high detail, clean edges, stable shapes, smooth motion, " +
    "natural textures, HDR, filmic color grading, soft key light, subtle rim light, global illumination, " +
    "35mm lens, shallow depth of field, soft bokeh, realistic exposure, crisp highlights, no flicker";

  // Mantiene la idea del usuario y solo agrega calidad
  return `${p}. ${cinematicPack}`;
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ user id desde tu helper
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // ✅ prompt con enhancer
    const promptRaw = String(body?.prompt || "").trim();
    const prompt = enhancePromptIfNeeded(promptRaw);

    // ✅ negative default si viene vacío
    const negativeRaw = String(body?.negative || body?.negative_prompt || "").trim();
    const negative_prompt = negativeRaw.length > 0 ? negativeRaw : defaultNegativePrompt();

    // ✅ NUEVO: frontend manda aspect_ratio solo si el usuario marcó 9:16
    // (si viene "", el worker usa default)
    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" o "9:16"

    // ✅ IMPORTANTE:
    // Ya NO forzamos 1080x1920. Si el frontend no manda width/height => null.
    // El worker decide el default (y si aspect_ratio=9:16, usa 1080x1920).
    const width =
      body?.width !== undefined && body?.width !== null && body?.width !== ""
        ? Number(body.width)
        : null;

    const height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : null;

    // ✅ Timing:
    // tu frontend nuevo manda duration_s (no seconds)
    const fps = Number(body?.fps || 24);
    const seconds = Number(body?.duration_s || body?.seconds || 3);

    // ✅ tu tabla usa num_frames
    const num_frames = Number(body?.num_frames || body?.frames || Math.round(fps * seconds));

    // ✅ defaults de calidad (podés cambiarlo)
    const steps = Number(body?.steps || 30); // antes 25
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
      negative_prompt,

      // ✅ si no vienen, quedan null y el worker decide
      width: width ?? null,
      height: height ?? null,

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

    // ✅ 3) RunPod
    const endpointId = pickT2VEndpointId();

    // ✅ input para worker:
    // - mandamos aspect_ratio SOLO si existe ("9:16")
    // - width/height SOLO si vinieron
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
      duration_s: seconds, // útil para logging; el worker usa num_frames igualmente
      ...(aspect_ratio ? { aspect_ratio } : {}),
      ...(typeof width === "number" && Number.isFinite(width) ? { width } : {}),
      ...(typeof height === "number" && Number.isFinite(height) ? { height } : {}),
    };

    const rp = await runpodRun({
      endpointId,
      input: rpInput,
    });

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