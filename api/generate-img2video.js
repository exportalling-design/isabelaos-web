// api/generate-img2video.js ✅ COLA REAL + NO payload con image_b64 + LIBERAR SLOT EN FAIL

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

const VIDEO_MAX_ACTIVE = Number(process.env.VIDEO_MAX_ACTIVE ?? 1);

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

function reserveOk(v) {
  if (v === true) return true;
  if (v === 1) return true;
  if (typeof v === "string" && v.toLowerCase() === "true") return true;
  if (v && typeof v === "object" && v.ok === true) return true;
  return false;
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

export default async function handler(req, res) {
  try {
    console.log("[GEN_I2V] VERSION 2026-02-02b");
    console.log("[GEN_I2V] VIDEO_MAX_ACTIVE:", VIDEO_MAX_ACTIVE);

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { finalPrompt, finalNegative } = pickFinalPrompts(body);
    if (!finalPrompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const image_b64 = body?.image_b64 ? String(body.image_b64) : null;
    const image_url = body?.image_url ? String(body.image_url).trim() : null;
    if (!image_b64 && !image_url) {
      return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });
    }

    const aspect_ratio = String(body?.aspect_ratio || "").trim();

    const fps = Number(body?.fps ?? 16);
    const num_frames = Number(body?.num_frames ?? body?.frames ?? 48);
    const steps = Number(body?.steps ?? 18);
    const guidance_scale = Number(body?.guidance_scale ?? 6.5);

    const width =
      body?.width !== undefined && body?.width !== null && body?.width !== ""
        ? Number(body.width)
        : 1280;

    const height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : 720;

    // ✅ 0) payload seguro (NO guardar base64)
    const safePayload = { ...(body || {}) };
    delete safePayload.image_b64;

    // ✅ 1) spend jades
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

    // ✅ 2) create job (QUEUED)
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
      payload: safePayload ? JSON.stringify(safePayload) : null,
      provider: "runpod",
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);
    if (insErr) {
      return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ 3) reservar cupo (COLA REAL)
    const { data: canDispatchRaw, error: lockErr } = await supabaseAdmin.rpc("reserve_video_slot", {
      p_job_id: jobId,
      p_max_active: VIDEO_MAX_ACTIVE,
    });

    const canDispatch = reserveOk(canDispatchRaw);

    if (lockErr || !canDispatch) {
      return res.status(200).json({ ok: true, job_id: jobId, queued: true });
    }

    // ✅ 4) despachar
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
      duration_s: body?.duration_s ?? body?.seconds ?? null,
      ...(aspect_ratio ? { aspect_ratio } : {}),
      width,
      height,
      image_b64,  // ✅ se manda al worker, pero NO se guarda en DB
      image_url,
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

      return res.status(200).json({ ok: true, job_id: jobId, queued: false, provider_request_id: runpodId });
    } catch (e) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "QUEUED",
          provider_status: `dispatch_failed: ${String(e?.message || e).slice(0, 180)}`,
        })
        .eq("id", jobId);

      // ✅ LIBERAR SLOT
      try {
        await supabaseAdmin.rpc("release_video_slot", { p_job_id: jobId });
      } catch {}

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
