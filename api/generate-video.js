// /api/generate-video.js  (SERVERLESS)
// ============================================================
// - Crea job en Supabase
// - Cobra 10 jades (server-side, atómico)
// - Lanza RunPod Serverless /run
// - Guarda provider_request_id para consultar status
// - Devuelve used_prompt / used_negative_prompt
//
// FIXES:
// ✅ NO marca DISPATCHED antes de tener requestId
// ✅ Si /run falla => status=ERROR con mensaje real
// ✅ /run VERBOSO: captura response text+status
// ============================================================

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";
const COST_T2V = 10;

const ACTIVE_STATUSES = [
  "PENDING",
  "IN_QUEUE",
  "QUEUED",
  "DISPATCHED",
  "IN_PROGRESS",
  "RUNNING",
];

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function getActiveJobForUser(sb, user_id, mode) {
  let q = sb
    .from(VIDEO_JOBS_TABLE)
    .select("*")
    .eq("user_id", user_id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);

  if (mode) q = q.eq("mode", mode);

  const { data, error } = await q;
  if (error) throw error;
  return data?.[0] || null;
}

// ✅ resolver prompt final (optimizado o normal)
function pickFinalPrompts(body) {
  const prompt = String(body?.prompt || "").trim();
  const negative = String(body?.negative_prompt || body?.negative || "").trim();

  const useOptimized = body?.use_optimized === true || body?.useOptimized === true;

  const optPrompt = String(body?.optimized_prompt || body?.optimizedPrompt || "").trim();
  const optNeg = String(body?.optimized_negative_prompt || body?.optimizedNegativePrompt || "").trim();

  const usingOptimized = Boolean(useOptimized && optPrompt);
  const finalPrompt = usingOptimized ? optPrompt : prompt;
  const finalNegative = usingOptimized ? optNeg : negative;

  return { finalPrompt, finalNegative, usingOptimized };
}

// ✅ COBRO server-side (RPC spend_jades)
async function spendJadesAtomic(sb, { user_id, amount, reason }) {
  const { data, error } = await sb.rpc("spend_jades", {
    p_user_id: user_id,
    p_amount: Number(amount),
    p_reason: String(reason || "spend"),
  });

  if (error) throw new Error(error.message || "No se pudo descontar jades.");
  if (data === false || data == null) throw new Error("No se pudo descontar jades (sin detalle).");
  return data;
}

// ✅ RunPod /run VERBOSO
async function runpodServerlessRun({ endpointId, input }) {
  if (!endpointId) throw new Error("Falta VIDEO_RUNPOD_ENDPOINT_ID");

  const url = `https://api.runpod.ai/v2/${endpointId}/run`;

  const r = await fetch(url, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify({ input }),
  });

  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}

  if (!r.ok) {
    throw new Error(`RunPod /run ${r.status}: ${j?.error || text || "sin detalle"}`);
  }

  const requestId = j?.id || j?.requestId || null;
  if (!requestId) throw new Error(`RunPod /run sin id: ${text}`);
  return { requestId, raw: j };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Método no permitido" });
    }

    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    const user_id = auth.user.id;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const {
      mode = "t2v",
      steps,
      height,
      width,
      num_frames,
      fps,
      guidance_scale,
      // extras opcionales (por si luego quieres)
      duration_s,
      seconds,
      aspect_ratio,
      platform_ref,
      seed,
    } = body;

    const { finalPrompt, finalNegative, usingOptimized } = pickFinalPrompts(body);
    if (!finalPrompt) {
      return res.status(400).json({ ok: false, error: "Falta prompt" });
    }

    const sb = sbAdmin();

    // A) si ya hay job activo, no crear otro
    const active = await getActiveJobForUser(sb, user_id, mode);
    if (active) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: active.job_id || active.id,
        job: active,
        using_optimized: usingOptimized,
        used_prompt: finalPrompt,
        used_negative_prompt: finalNegative,
      });
    }

    // ✅ COBRO
    await spendJadesAtomic(sb, {
      user_id,
      amount: COST_T2V,
      reason: "video_from_prompt",
    });

    // 1) crear job en Supabase
    const job_id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const payloadToStore = {
      user_id,
      mode,
      prompt: finalPrompt,
      negative_prompt: finalNegative,
      steps,
      height,
      width,
      num_frames,
      fps,
      guidance_scale,
      duration_s,
      seconds,
      aspect_ratio,
      platform_ref,
      seed,
    };

    const { error: insErr } = await sb.from(VIDEO_JOBS_TABLE).insert([
      {
        job_id,
        user_id,
        mode,
        status: "QUEUED",
        progress: 0,
        queue_position: null,
        eta_seconds: null,
        payload: payloadToStore,
        error: null,
        video_url: null,
        provider: "runpod_serverless",
        provider_request_id: null,
        provider_reply: null,
        created_at: nowIso,
        updated_at: nowIso,
      },
    ]);
    if (insErr) throw new Error(`No pude insertar video_jobs: ${insErr.message}`);

    // 2) Llamar RunPod /run (NO marcamos DISPATCHED todavía)
    const input = {
      job_id,
      user_id,
      mode: "t2v",
      prompt: finalPrompt,
      negative_prompt: finalNegative,
      steps,
      height,
      width,
      num_frames,
      fps,
      guidance_scale,
      duration_s,
      seconds,
      aspect_ratio,
      platform_ref,
      seed,
    };

    let run;
    try {
      run = await runpodServerlessRun({ endpointId: VIDEO_RUNPOD_ENDPOINT_ID, input });
    } catch (e) {
      // ✅ si falla /run, marcar ERROR con detalle real
      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({
          status: "ERROR",
          error: `RUNPOD_RUN_FAILED: ${String(e?.message || e)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", job_id);

      throw e;
    }

    // 3) Ya con requestId, marcamos DISPATCHED/IN_PROGRESS correctamente
    await sb
      .from(VIDEO_JOBS_TABLE)
      .update({
        status: "IN_PROGRESS",
        provider_request_id: run.requestId,
        provider_reply: run.raw,
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", job_id);

    return res.status(200).json({
      ok: true,
      status: "IN_PROGRESS",
      job_id,
      provider: { request_id: run.requestId },
      using_optimized: usingOptimized,
      used_prompt: finalPrompt,
      used_negative_prompt: finalNegative,
    });
  } catch (e) {
    console.error("[generate-video] fatal:", e);
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
}