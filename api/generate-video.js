// /api/generate-video.js
export const runtime = "nodejs";

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_VIDEO_ENDPOINT_ID = process.env.RUNPOD_VIDEO_ENDPOINT_ID;

const COST_T2V = Number(process.env.COST_VIDEO_T2V || 10); // tu costo default

function json(code, obj) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getBearer(req) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function runpodRun(payload) {
  const url = `https://api.runpod.ai/v2/${RUNPOD_VIDEO_ENDPOINT_ID}/run`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`runpod_run_failed_${r.status}: ${JSON.stringify(j)}`);
  return j;
}

export default async function handler(req) {
  try {
    if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

    const token = getBearer(req);
    if (!token) return json(401, { ok: false, error: "missing_auth" });

    const body = await req.json().catch(() => null);
    if (!body) return json(400, { ok: false, error: "invalid_json" });

    const {
      prompt,
      negative = "",
      duration_s = 3,
      fps = 24,
      aspect_ratio = "1:1",
      steps = 18,
      guidance_scale = 5,
    } = body;

    if (!prompt || String(prompt).trim().length < 2) {
      return json(400, { ok: false, error: "missing_prompt" });
    }

    // Supabase client (service role) + validar usuario desde token
    const supabase = createClient(SB_URL, SB_SERVICE_ROLE);
    const { data: u, error: uerr } = await supabase.auth.getUser(token);
    if (uerr || !u?.user?.id) return json(401, { ok: false, error: "invalid_auth" });
    const userId = u.user.id;

    // 1) Cobro jades (RPC)
    // Ajusta nombres si tu RPC es diferente: spend_jades(user_id, amount, reason, meta)
    const { data: spendRes, error: spendErr } = await supabase.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: COST_T2V,
      p_reason: "video_t2v",
      p_meta: { duration_s, fps, aspect_ratio, steps, guidance_scale },
    });

    if (spendErr) {
      return json(402, { ok: false, error: "insufficient_jades_or_spend_failed", detail: spendErr.message });
    }

    // (Opcional) si tu RPC devuelve balance:
    const jadesAfter = spendRes?.new_balance ?? spendRes?.balance ?? null;

    // 2) Crear job DB
    const jobInsert = {
      user_id: userId,
      status: "QUEUED",
      provider: "runpod",
      provider_status: "QUEUED",
      progress: 3,
      prompt,
      negative_prompt: negative,
      duration_s,
      fps,
      aspect_ratio,
      steps,
      guidance_scale,
      cost_jades: COST_T2V,
    };

    const { data: job, error: jerr } = await supabase
      .from("video_jobs")
      .insert(jobInsert)
      .select("*")
      .single();

    if (jerr || !job) {
      return json(500, { ok: false, error: "db_insert_failed", detail: jerr?.message });
    }

    // 3) Enviar a RunPod
    if (!RUNPOD_API_KEY || !RUNPOD_VIDEO_ENDPOINT_ID) {
      // Si no hay creds, queda en cola (pero ya cobró)
      return json(200, { ok: true, job_id: job.id, status: "QUEUED", jades_after: jadesAfter, note: "missing_runpod_env" });
    }

    const rpPayload = {
      input: {
        mode: "t2v",
        prompt,
        negative_prompt: negative,
        duration_s,
        fps,
        aspect_ratio,
        steps,
        guidance_scale,
        // Para que el worker pueda devolver el job_id y tú lo logs
        job_id: job.id,
        user_id: userId,
      },
    };

    const rp = await runpodRun(rpPayload);

    // Runpod devuelve típicamente { id: "xxxx-u2", ... }
    const providerRequestId = rp?.id || rp?.requestId || null;

    await supabase
      .from("video_jobs")
      .update({
        provider_request_id: providerRequestId,
        provider_status: "SUBMITTED",
        status: "PROCESSING",
        progress: 7,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return json(200, {
      ok: true,
      job_id: job.id,
      provider_request_id: providerRequestId,
      status: "PROCESSING",
      progress: 7,
      cost: COST_T2V,
      jades_after: jadesAfter,
    });
  } catch (err) {
    return json(500, { ok: false, error: "generate_video_exception", detail: String(err) });
  }
}
