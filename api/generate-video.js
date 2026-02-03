// api/generate-video.js  (WAN Serverless) ✅ COLA REAL + defaults consistentes
export const config = { runtime: "nodejs" };

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
  if (!r.ok) throw new Error(`RunPod /run failed: ${r.status} ${data?.error || data?.message || JSON.stringify(data)}`);
  return data;
}

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

function normalizeSeconds(body) {
  const raw = body?.duration_s ?? body?.seconds ?? null;
  let s = raw === null || raw === undefined || raw === "" ? 3 : Number(raw);
  if (!Number.isFinite(s)) s = 3;
  s = clampInt(s, 3, 5, 3);
  return s < 4 ? 3 : 5;
}

// ✅ mismos tamaños del worker
function pickDims(body) {
  const ar = String(body?.aspect_ratio || "").trim();
  if (ar === "9:16") return { width: 576, height: 1024 };
  return { width: 576, height: 512 };
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

  if (!finalPrompt) return { finalPrompt: "", finalNegative: finalNegative || "" };
  return { finalPrompt, finalNegative: finalNegative || "" };
}

export default async function handler(req, res) {
  try {
    console.log("[GEN_VIDEO] VERSION 2026-02-02b");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { finalPrompt, finalNegative } = pickFinalPrompts(body);
    if (!finalPrompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const aspect_ratio = String(body?.aspect_ratio || "").trim();
    const seconds = normalizeSeconds(body);
    const fps = clampInt(body?.fps ?? 16, 8, 30, 16);

    const requestedFrames = body?.num_frames ?? body?.frames ?? body?.numFrames ?? null;
    const num_frames = fixFramesForWan(
      requestedFrames !== null && requestedFrames !== undefined && requestedFrames !== ""
        ? Number(requestedFrames)
        : seconds * fps
    );

    const steps = clampInt(body?.steps ?? 18, 1, 80, 18);
    const guidance_scale = Number(body?.guidance_scale ?? 5.0);

    const dims = pickDims(body);
    const width = dims.width;
    const height = dims.height;

    // ✅ 1) spend jades
    const ref = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 10,
      p_reason: "t2v_generate",
      p_ref: ref,
    });

    if (spendErr) return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });

    // ✅ 2) create job QUEUED
    const jobId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

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
    if (insErr) return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });

    // ✅ 3) reservar slot (cola real)
    const { data: canDispatch, error: lockErr } = await supabaseAdmin.rpc("reserve_video_slot", {
      p_job_id: jobId,
      p_max_active: VIDEO_MAX_ACTIVE,
    });

    if (lockErr || !canDispatch) {
      return res.status(200).json({ ok: true, job_id: jobId, queued: true });
    }

    // ✅ 4) despachar
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

      await supabaseAdmin
        .from("video_jobs")
        .update({
          provider_request_id: runpodId ? String(runpodId) : null,
          provider_status: "submitted",
          status: "IN_PROGRESS",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return res.status(200).json({ ok: true, job_id: jobId, queued: false, provider_request_id: runpodId });
    } catch (e) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "QUEUED",
          provider_status: `dispatch_failed: ${String(e?.message || e).slice(0, 180)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return res.status(200).json({ ok: true, job_id: jobId, queued: true, reason: "dispatch_failed_returned_to_queue" });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}
