// api/generate-video.js
export const runtime = "nodejs";

import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

async function runpodRun({ endpointId, apiKey, input }) {
  const url = `https://api.runpod.ai/v2/${endpointId}/run`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`RunPod /run failed: ${r.status} ${JSON.stringify(data)}`);
  }
  // Respuesta típica: { id: "xxxx", status: "IN_QUEUE" ... }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const admin = getSupabaseAdmin();

    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    const negative_prompt = String(body.negative_prompt || body.negative || "").trim();

    // opciones que mandas desde tu UI
    const aspect = String(body.aspect || "9:16");
    const width = Number(body.width || 1080);
    const height = Number(body.height || 1920);
    const fps = Number(body.fps || 24);
    const seconds = Number(body.seconds || 3);
    const frames = Number(body.frames || Math.round(fps * seconds));
    const steps = Number(body.steps || 25);

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // --- (A) cobrar jades (OPCIONAL) ---
    // Si quieres que cobre aquí:
    // const COST = 10;
    // const { error: spendErr } = await admin.rpc("spend_jades", {
    //   p_user_id: user_id,
    //   p_amount: COST,
    //   p_reason: "video_from_prompt",
    //   p_ref: null,
    // });
    // if (spendErr) return res.status(400).json({ ok: false, error: "Jades spend failed", spendErr });

    // --- (B) crear job en DB ---
    const insertPayload = {
      user_id,
      status: "QUEUED",
      prompt,
      negative_prompt,
      provider: "runpod",
      provider_status: "QUEUED",
      // si estas columnas NO existen, bórralas:
      fps,
      seconds,
      frames,
      width,
      height,
      aspect,
      steps,
    };

    const { data: job, error: insertErr } = await admin
      .from("video_jobs")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertErr || !job?.id) {
      return res.status(500).json({
        ok: false,
        error: "video_jobs insert failed",
        message: insertErr?.message || null,
        details: insertErr?.details || null,
        hint: insertErr?.hint || null,
        code: insertErr?.code || null,
        insertPayload,
      });
    }

    // --- (C) enviar a RunPod ---
    const RUNPOD_ENDPOINT_ID = mustEnv("RUNPOD_VIDEO_ENDPOINT_ID"); // <-- ponlo en Vercel
    const RUNPOD_API_KEY = mustEnv("RUNPOD_API_KEY");              // <-- ponlo en Vercel

    const rp = await runpodRun({
      endpointId: RUNPOD_ENDPOINT_ID,
      apiKey: RUNPOD_API_KEY,
      input: {
        job_id: job.id,
        user_id,
        prompt,
        negative_prompt,
        width,
        height,
        fps,
        frames,
        seconds,
        steps,
        aspect,
        // agrega aquí lo que tu worker espera
      },
    });

    const provider_request_id = rp?.id || null;

    // --- (D) guardar provider_request_id ---
    const { error: updErr } = await admin
      .from("video_jobs")
      .update({
        provider_request_id,
        provider_status: rp?.status || "IN_QUEUE",
        status: "IN_PROGRESS",
      })
      .eq("id", job.id);

    if (updErr) {
      // el job ya se mandó a runpod; pero falló el update
      return res.status(200).json({
        ok: true,
        job_id: job.id,
        provider_request_id,
        warning: "RunPod started but DB update failed",
        updErr,
      });
    }

    return res.status(200).json({
      ok: true,
      job_id: job.id,
      provider_request_id,
      status: "IN_PROGRESS",
      runpod_status: rp?.status || "IN_QUEUE",
    });
  } catch (err) {
    console.error("generate-video fatal:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}