// /api/generate-video.js  (SERVERLESS)
// ============================================================
// - Crea job en Supabase (video_jobs)
// - ✅ Cobra 10 jades SERVER-SIDE (spend_jades) por defecto
// - ✅ Soporta ya_billed=true (si alguna UI vieja lo manda)
// - Ajusta width/height para que sean divisibles por 16
// - Lanza RunPod Serverless /run
// - Guarda provider_request_id para consultar status
// - Guarda billed_amount/billed_at en payload (para refund automático)
// ============================================================

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;
const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID || null;

const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

const COST_T2V = 10;

const ACTIVE_STATUSES = ["PENDING", "IN_QUEUE", "QUEUED", "DISPATCHED", "IN_PROGRESS", "RUNNING"];

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
  const negative = String(body?.negative_prompt || "").trim();

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

// -----------------------
// ✅ snap dims a múltiplos de 16
// -----------------------
function snap16(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return fallback;
  const r = Math.round(x / 16) * 16;
  return Math.max(16, r);
}

function sanitizeDims(width, height, fallbackW, fallbackH) {
  const w = snap16(width, fallbackW);
  const h = snap16(height, fallbackH);
  return { width: w, height: h };
}

// Normaliza duración 3/5 como tu UI
function normalizeTiming(body) {
  const fps = Number(body?.fps ?? 24);
  const duration_s = Number(body?.duration_s ?? body?.seconds ?? 3);

  const seconds = duration_s < 4 ? 3 : 5;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 24;

  const num_frames_raw = body?.num_frames ?? body?.frames;
  const numFramesFallback = Math.round(seconds * safeFps);
  const num_frames = Number.isFinite(Number(num_frames_raw))
    ? Math.max(1, Math.round(Number(num_frames_raw)))
    : numFramesFallback;

  return { seconds, fps: safeFps, num_frames };
}

async function runpodServerlessRun({ endpointId, input }) {
  if (!endpointId) throw new Error("Falta VIDEO_RUNPOD_ENDPOINT_ID");
  const url = `https://api.runpod.ai/v2/${endpointId}/run`;

  const r = await fetch(url, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify({ input }),
  });

  const txt = await r.text();
  let j = null;
  try {
    j = JSON.parse(txt);
  } catch {
    j = null;
  }

  if (!r.ok || !j) throw new Error((j && j.error) || `RunPod /run falló (${r.status}): ${txt.slice(0, 180)}`);

  const requestId = j?.id || j?.requestId || null;
  if (!requestId) throw new Error("RunPod /run no devolvió id");
  return { requestId, raw: j };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const {
      mode = "t2v",
      steps,
      guidance_scale,
      platform_ref,
      aspect_ratio,
      already_billed, // compatibilidad
    } = body;

    const { finalPrompt, finalNegative, usingOptimized } = pickFinalPrompts(body);
    if (!finalPrompt) return res.status(400).json({ ok: false, error: "Falta prompt" });

    const sb = sbAdmin();

    // A) evita jobs concurrentes
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

    // ✅ timing 3/5
    const timing = normalizeTiming(body);

    // ✅ dims /16 (fallbacks)
    const fallbackW = 1088;
    const fallbackH = 1920;
    const dims = sanitizeDims(body?.width, body?.height, fallbackW, fallbackH);

    // ✅ COBRO server-side (por defecto cobra)
    const willBill = already_billed === true ? false : true;
    const billedAmount = willBill ? COST_T2V : 0;
    const billedAt = willBill ? new Date().toISOString() : null;

    if (willBill) {
      await spendJadesAtomic(sb, { user_id, amount: COST_T2V, reason: "video_from_prompt" });
    }

    // 1) crear job en supabase
    const job_id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const payloadToStore = {
      user_id,
      mode,
      prompt: finalPrompt,
      negative_prompt: finalNegative,
      steps,
      guidance_scale,
      platform_ref: platform_ref || null,
      aspect_ratio: aspect_ratio || null,
      width: dims.width,
      height: dims.height,
      duration_s: timing.seconds,
      fps: timing.fps,
      num_frames: timing.num_frames,
      using_optimized: usingOptimized,

      // ✅ billing guardado para refund
      billing: {
        already_billed: already_billed === true,
        billed_amount: billedAmount,
        billed_at: billedAt,
      },
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
        created_at: nowIso,
        updated_at: nowIso,
      },
    ]);

    if (insErr) throw new Error(`No pude insertar video_jobs: ${insErr.message}`);

    // 2) dispatch a RunPod
    await sb.from(VIDEO_JOBS_TABLE).update({ status: "DISPATCHED", updated_at: new Date().toISOString() }).eq("job_id", job_id);

    const input = {
      job_id,
      user_id,
      mode: "t2v",
      prompt: finalPrompt,
      negative_prompt: finalNegative,
      steps,
      guidance_scale,
      platform_ref: platform_ref || "",
      aspect_ratio: aspect_ratio || "",
      width: dims.width,
      height: dims.height,
      duration_s: timing.seconds,
      fps: timing.fps,
      num_frames: timing.num_frames,
    };

    const run = await runpodServerlessRun({ endpointId: VIDEO_RUNPOD_ENDPOINT_ID, input });

    await sb
      .from(VIDEO_JOBS_TABLE)
      .update({
        status: "IN_PROGRESS",
        provider_request_id: run.requestId,
        payload: { ...payloadToStore, runpod_raw: run.raw },
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
      used_dims: dims,
      used_timing: timing,
      billed_amount: billedAmount,
    });
  } catch (e) {
    console.error("[generate-video] fatal:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}