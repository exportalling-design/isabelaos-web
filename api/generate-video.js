// api/generate-video.js  (WAN Serverless)  ✅ CON COLA REAL

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

const VIDEO_MAX_ACTIVE = Number(process.env.VIDEO_MAX_ACTIVE ?? 1);

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
// ✅ COMPOSICIÓN FORZADA
// ------------------------------------------------------------
const COMPOSITION_SUFFIX =
  " | centered subject, stable framing, head and shoulders, medium shot, " +
  "subject fully in frame, face fully visible, looking at camera, " +
  "no extreme close-up, no partial face";

// ------------------------------------------------------------
// ✅ PROMPTS DEFAULT
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

  const finalPrompt = `${basePrompt}${COMPOSITION_SUFFIX}`;
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
// ✅ WAN helpers
// ------------------------------------------------------------
function clampInt(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const r = Math.round(n);
  return Math.max(lo, Math.min(hi, r));
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

function pickDims(body) {
  const ar = String(body?.aspect_ratio || "").trim();
  if (ar === "9:16") return { width: 576, height: 1024 };
  return { width: 576, height: 512 };
}

export default async function handler(req, res) {
  try {
    console.log("[GEN_VIDEO] VERSION 2026-02-02");
    console.log("[GEN_VIDEO] VIDEO_MAX_ACTIVE:", VIDEO_MAX_ACTIVE);
    console.log("[GEN_VIDEO] RP endpoint env:", {
      RP_WAN22_T2V_ENDPOINT: process.env.RP_WAN22_T2V_ENDPOINT ? "set" : "missing",
      VIDEO_RUNPOD_ENDPOINT_ID: process.env.VIDEO_RUNPOD_ENDPOINT_ID ? "set" : "missing",
      VIDEO_RUNPOD_ENDPOINT: process.env.VIDEO_RUNPOD_ENDPOINT ? "set" : "missing",
      RUNPOD_API_KEY: RUNPOD_API_KEY ? "set" : "missing",
    });

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { finalPrompt, finalNegative, usedDefault } = pickFinalPrompts(body);
    const aspect_ratio = String(body?.aspect_ratio || "").trim();

    const seconds = normalizeDurationSeconds(body);
    const fps = clampInt(body?.fps ?? 16, 8, 30, 16);

    const requestedFrames = body?.num_frames ?? body?.frames ?? body?.numFrames ?? null;
    const num_frames = fixFramesForWan(
      requestedFrames !== null && requestedFrames !== undefined && requestedFrames !== ""
        ? Number(requestedFrames)
        : seconds * fps
    );

    const steps = Number(body?.steps ?? 18);
    const guidance_scale = Number(body?.guidance_scale ?? 5.0);

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

    // ✅ 2) crear job en cola
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

    console.log("[GEN_VIDEO] inserting video_jobs:", { id: jobId, user_id: userId, mode: "t2v" });

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);
    if (insErr) {
      console.log("[GEN_VIDEO] insert FAILED:", insErr);
      return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ 3) intentar reservar cupo (COLA REAL)
    const { data: canDispatch, error: lockErr } = await supabaseAdmin.rpc("reserve_video_slot", {
      p_job_id: jobId,
      p_max_active: VIDEO_MAX_ACTIVE,
    });

    if (lockErr) {
      // si falló el lock, deja en cola
      return res.status(200).json({
        ok: true,
        job_id: jobId,
        queued: true,
        reason: `reserve_video_slot error: ${lockErr.message}`,
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
        },
      });
    }

    if (!canDispatch) {
      // ✅ NO hay cupo => queda en cola, NO llamamos RunPod
      return res.status(200).json({
        ok: true,
        job_id: jobId,
        queued: true,
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
        },
      });
    }

    // ✅ 4) hay cupo => despachar a RunPod
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
      ...(aspect_ratio ? { aspect_ratio } : {}),
      width,
      height,
    };

    try {
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
        queued: false,
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
        },
      });
    } catch (e) {
      // ✅ si RunPod falla, devolvemos a cola (para reintentar)
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "QUEUED",
          provider_status: `dispatch_failed: ${String(e?.message || e).slice(0, 180)}`,
        })
        .eq("id", jobId);

      return res.status(200).json({
        ok: true,
        job_id: jobId,
        queued: true,
        reason: "dispatch_failed_returned_to_queue",
      });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
