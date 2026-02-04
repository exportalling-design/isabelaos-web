// /api/generate-img2video.js
export const runtime = "nodejs";

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_VIDEO_ENDPOINT_ID = process.env.RUNPOD_VIDEO_ENDPOINT_ID;

const COST_I2V = Number(process.env.COST_VIDEO_I2V || 25);

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

function stripDataUrlToB64(dataUrl) {
  // "data:image/png;base64,AAA..."
  const m = String(dataUrl || "").match(/^data:.*?;base64,(.+)$/);
  return m ? m[1] : null;
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

      // input image
      image_data_url = null, // data:image/...;base64
      image_b64 = null,      // puro base64
      image_url = null,      // url
    } = body;

    if (!prompt || String(prompt).trim().length < 2) {
      return json(400, { ok: false, error: "missing_prompt" });
    }

    const b64 =
      image_b64 ||
      stripDataUrlToB64(image_data_url) ||
      null;

    if (!b64 && !image_url) {
      return json(400, { ok: false, error: "missing_image", detail: "send image_b64 OR image_data_url OR image_url" });
    }

    const supabase = createClient(SB_URL, SB_SERVICE_ROLE);
    const { data: u, error: uerr } = await supabase.auth.getUser(token);
    if (uerr || !u?.user?.id) return json(401, { ok: false, error: "invalid_auth" });
    const userId = u.user.id;

    // Cobro
    const { data: spendRes, error: spendErr } = await supabase.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: COST_I2V,
      p_reason: "video_i2v",
      p_meta: { duration_s, fps, aspect_ratio, steps, guidance_scale },
    });

    if (spendErr) {
      return json(402, { ok: false, error: "insufficient_jades_or_spend_failed", detail: spendErr.message });
    }

    const jadesAfter = spendRes?.new_balance ?? spendRes?.balance ?? null;

    // Crear job
    const { data: job, error: jerr } = await supabase
      .from("video_jobs")
      .insert({
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
        cost_jades: COST_I2V,
      })
      .select("*")
      .single();

    if (jerr || !job) return json(500, { ok: false, error: "db_insert_failed", detail: jerr?.message });

    if (!RUNPOD_API_KEY || !RUNPOD_VIDEO_ENDPOINT_ID) {
      return json(200, { ok: true, job_id: job.id, status: "QUEUED", jades_after: jadesAfter, note: "missing_runpod_env" });
    }

    const rpPayload = {
      input: {
        mode: "i2v",
        prompt,
        negative_prompt: negative,
        duration_s,
        fps,
        aspect_ratio,
        steps,
        guidance_scale,
        job_id: job.id,
        user_id: userId,

        // imagen
        image_b64: b64 || null,
        image_url: image_url || null,
      },
    };

    const rp = await runpodRun(rpPayload);
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
      cost: COST_I2V,
      jades_after: jadesAfter,
    });
  } catch (err) {
    return json(500, { ok: false, error: "generate_img2video_exception", detail: String(err) });
  }
}
