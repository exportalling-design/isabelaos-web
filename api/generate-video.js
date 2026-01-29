// api/generate-video.js
export const runtime = "nodejs";

import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const COST_T2V = 10;

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

async function runpodFetchWithRetry(url, apiKey, payload) {
  // RunPod a veces acepta Authorization con Bearer o sin Bearer según endpoint/ejemplos.
  // Aquí lo hacemos robusto: intentamos Bearer -> si 401/403, reintentamos sin Bearer.
  const headersA = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const r1 = await fetch(url, {
    method: "POST",
    headers: headersA,
    body: JSON.stringify(payload),
  });

  if (r1.status !== 401 && r1.status !== 403) return r1;

  const headersB = {
    "Content-Type": "application/json",
    Authorization: apiKey,
  };

  return fetch(url, {
    method: "POST",
    headers: headersB,
    body: JSON.stringify(payload),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const admin = getSupabaseAdmin();
    const user_id = await getUserIdFromAuthHeader(req);

    if (!user_id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    const negative_prompt = String(body.negative_prompt || body.negative || "").trim();

    const duration_s = Number(body.duration_s ?? body.seconds ?? 3);
    const fps = Number(body.fps ?? 24);
    const num_frames = Math.max(1, Math.round(duration_s * fps));

    const width = Number(body.width ?? 1080);
    const height = Number(body.height ?? 1920);

    // 1) crear job en supabase
    const { data: job, error: insertErr } = await admin
      .from("video_jobs")
      .insert({
        user_id,
        status: "QUEUED",
        provider: "runpod",
        provider_status: "QUEUED",
        prompt,
        negative_prompt,
        width,
        height,
        fps,
        num_frames,
        duration_s,
      })
      .select("id")
      .single();

    if (insertErr || !job?.id) {
      return res.status(500).json({ ok: false, error: "video_jobs insert failed", detail: insertErr?.message });
    }

    // 2) cobrar jades (tu firma real)
    const { error: spendErr } = await admin.rpc("spend_jades", {
      p_user_id: user_id,
      p_amount: COST_T2V,
      p_reason: "video_generation",
      p_ref: String(job.id),
    });

    if (spendErr) {
      await admin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_reply: { error: spendErr.message },
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return res.status(400).json({ ok: false, error: "Jades spend failed", detail: spendErr.message });
    }

    // 3) enviar a runpod
    const apiKey = mustEnv("RUNPOD_API_KEY");
    const endpointId = mustEnv("RUNPOD_ENDPOINT_ID");
    const baseUrl = process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2";

    // 🔥 SUPER IMPORTANTE: este endpointId debe ser EXACTAMENTE el serverless endpoint que estás viendo.
    // Si está apuntando a otro, RunPod te saldrá “sin jobs”.
    const url = `${baseUrl}/${endpointId}/run`;

    const payload = {
      input: {
        mode: "t2v",
        prompt,
        negative_prompt,
        duration_s,
        fps,
        num_frames,
        width,
        height,
        // Te dejo el job_id para que el worker lo pueda devolver/registrar si querés
        job_id: String(job.id),
      },
    };

    const rpRes = await runpodFetchWithRetry(url, apiKey, payload);
    const rpJson = await rpRes.json().catch(() => null);

    // Guardamos SIEMPRE el raw para depurar
    await admin
      .from("video_jobs")
      .update({
        provider_reply: rpJson,
        provider_status: `HTTP_${rpRes.status}`,
      })
      .eq("id", job.id);

    if (!rpRes.ok || !rpJson?.id) {
      await admin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return res.status(500).json({
        ok: false,
        error: "RunPod run failed",
        detail: rpJson,
        http_status: rpRes.status,
      });
    }

    await admin
      .from("video_jobs")
      .update({
        status: "RUNNING",
        provider_status: "SUBMITTED",
        provider_request_id: rpJson.id,
      })
      .eq("id", job.id);

    return res.status(200).json({ ok: true, job_id: job.id, request_id: rpJson.id, status: "RUNNING" });
  } catch (err) {
    console.error("❌ generate-video fatal:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}