// api/generate-video.js
export const runtime = "nodejs";

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

// ✅ Intenta RPC named y si falla, cae a posicional
async function spendJadesSafe(admin, { user_id, amount, kind, ref }) {
  // 1) NAMED (por si tu función es spend_jades(p_user_id uuid, p_amount int, ...)
  const namedPayloads = [
    { p_user_id: user_id, p_amount: amount, p_kind: kind, p_ref: String(ref) },
    { user_id, amount, kind, ref: String(ref) },
    { uid: user_id, amt: amount, k: kind, reference: String(ref) },
  ];

  let lastErr = null;

  for (const payload of namedPayloads) {
    const { error } = await admin.rpc("spend_jades", payload);
    if (!error) return { ok: true, mode: "named", payload };
    lastErr = error;
  }

  // 2) POSICIONAL (por si tu firma es spend_jades(uuid, integer, text, text))
  const { error: posErr } = await admin.rpc("spend_jades", [
    user_id,
    amount,
    kind,
    String(ref),
  ]);

  if (!posErr) return { ok: true, mode: "positional" };

  // si fallaron ambos:
  const msg = `${lastErr?.message || "named_failed"} | ${posErr?.message || "positional_failed"}`;
  return { ok: false, error: new Error(msg) };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const admin = getSupabaseAdmin();

    // ---------------------------------------------------
    // 1) Auth
    // ---------------------------------------------------
    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    // ---------------------------------------------------
    // 2) Body (compat con tu frontend)
    // ---------------------------------------------------
    const body = req.body || {};

    const mode = String(body.mode || "t2v").trim().toLowerCase(); // worker: "t2v"
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

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // ---------------------------------------------------
    // 3) Crear job
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

    if (insertErr || !job?.id) {
      return res.status(500).json({
        ok: false,
        error: "video_jobs insert failed",
        detail: insertErr?.message || "insert_error",
      });
    }

    // ---------------------------------------------------
    // 4) Cobro jades (blindado)
    // ---------------------------------------------------
    if (!already_billed) {
      const spend = await spendJadesSafe(admin, {
        user_id,
        amount: COST_T2V,
        kind: "t2v",
        ref: job.id,
      });

      if (!spend.ok) {
        await admin
          .from("video_jobs")
          .update({
            status: "FAILED",
            provider_status: "FAILED",
            provider_reply: { error: spend.error.message },
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        return res.status(400).json({
          ok: false,
          error: "Jades spend failed",
          detail: spend.error.message, // ✅ aquí verás la razón exacta
        });
      }
    }

    // ---------------------------------------------------
    // 5) RunPod serverless /run
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