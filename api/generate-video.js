// api/generate-video.js
export const runtime = "nodejs"; // importante en Vercel

import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const COST_T2V = 10;

function getRunpodConfig() {
  const apiKey = process.env.RUNPOD_API_KEY;
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const baseUrl = process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2";

  if (!apiKey) throw new Error("RUNPOD_API_KEY missing");
  if (!endpointId) throw new Error("RUNPOD_ENDPOINT_ID missing");

  return { apiKey, endpointId, baseUrl };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const admin = getSupabaseAdmin();

    // ---------------------------------------------------
    // 1) Usuario autenticado
    // ---------------------------------------------------
    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    // ---------------------------------------------------
    // 2) Leer body (compat con tu frontend actual)
    // ---------------------------------------------------
    const body = req.body || {};

    const mode = String(body.mode || "t2v").trim().toLowerCase(); // tu worker usa "t2v"
    const prompt = String(body.prompt || "").trim();
    const negative_prompt = String(body.negative_prompt || body.negative || "").trim();

    const platform_ref = String(body.platform_ref || "").trim();
    const aspect_ratio = String(body.aspect_ratio || "").trim();

    const width = Number(body.width ?? 640);
    const height = Number(body.height ?? 360);

    const duration_s = Number(body.duration_s ?? body.seconds ?? 3);
    const fps = Number(body.fps ?? 24);
    const num_frames = Number(body.num_frames ?? Math.max(1, Math.round(duration_s * fps)));

    const steps = Number(body.steps ?? 20);
    const guidance_scale = Number(body.guidance_scale ?? 5.0);

    const already_billed = !!body.already_billed;

    if (!prompt) {
      return res.status(400).json({ ok: false, error: "Missing prompt" });
    }

    // ---------------------------------------------------
    // 3) Crear job en video_jobs
    // ---------------------------------------------------
    const { data: job, error: insertErr } = await admin
      .from("video_jobs")
      .insert({
        user_id,
        status: "QUEUED",
        provider: "runpod",
        provider_status: "QUEUED",
        provider_raw: {
          mode,
          prompt,
          negative_prompt,
          platform_ref,
          aspect_ratio,
          width,
          height,
          duration_s,
          fps,
          num_frames,
          steps,
          guidance_scale,
          used_optimized: !!body.used_optimized,
        },
      })
      .select("id")
      .single();

    if (insertErr) {
      return res.status(500).json({
        ok: false,
        error: "video_jobs insert failed",
        detail: insertErr.message,
      });
    }

    // ---------------------------------------------------
    // 4) Cobro de jades (SERVER-SIDE)
    // OJO: ajusta nombres de params si tu RPC usa otros
    // ---------------------------------------------------
    if (!already_billed) {
      const { error: spendErr } = await admin.rpc("spend_jades", {
        p_user_id: user_id,
        p_amount: COST_T2V,
        p_kind: "t2v",
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

        return res.status(400).json({
          ok: false,
          error: "Jades spend failed",
          detail: spendErr.message,
        });
      }
    }

    // ---------------------------------------------------
    // 5) Enviar a RunPod Serverless
    // ---------------------------------------------------
    const { apiKey, endpointId, baseUrl } = getRunpodConfig();
    const runUrl = `${baseUrl}/${endpointId}/run`;

    const rp = await fetch(runUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          mode, // "t2v"
          prompt,
          negative_prompt,

          platform_ref,
          aspect_ratio,
          width,
          height,

          duration_s,
          fps,
          num_frames,

          steps,
          guidance_scale,
        },
      }),
    });

    const rpJson = await rp.json().catch(() => null);

    if (!rp.ok || !rpJson?.id) {
      await admin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "FAILED",
          provider_reply: rpJson || { error: "RunPod bad response" },
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      return res.status(500).json({
        ok: false,
        error: "RunPod run failed",
        detail: rpJson || "no-json",
      });
    }

    // Guardar request id
    await admin
      .from("video_jobs")
      .update({
        status: "RUNNING",
        provider_status: "SUBMITTED",
        provider_request_id: rpJson.id,
        provider_reply: rpJson,
      })
      .eq("id", job.id);

    return res.status(200).json({
      ok: true,
      job_id: job.id,
      status: "RUNNING",
    });
  } catch (err) {
    console.error("❌ generate-video fatal:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "server_error",
    });
  }
}