// pages/api/generar-video.js

export const runtime = "nodejs"; // ⛔️ OBLIGATORIO (NO EDGE)

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getUserIdFromAuthHeader } from "@/lib/getUserIdFromAuth";

const COST_T2V = 10;

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

    const {
      prompt,
      negative = "",
      seconds = 3,
      fps = 24,
      width = 640,
      height = 360,
      already_billed = false,
    } = req.body || {};

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ ok: false, error: "Missing prompt" });
    }

    // ---------------------------------------------------
    // 2) Crear job en video_jobs
    // ---------------------------------------------------
    const { data: job, error: insertErr } = await admin
      .from("video_jobs")
      .insert({
        user_id,
        status: "QUEUED",
        provider: "runpod",
        provider_status: "QUEUED",
        provider_raw: {
          prompt,
          negative,
          seconds,
          fps,
          width,
          height,
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
    // 3) Cobro de jades (RPC POSICIONAL – TU FUNCIÓN REAL)
    // signature: spend_jades(uuid, integer, text, text)
    // ---------------------------------------------------
    if (!already_billed) {
      const { error: spendErr } = await admin.rpc("spend_jades", [
        user_id,
        COST_T2V,
        "t2v",
        job.id,
      ]);

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
    // 4) 🔥 AQUÍ VA TU LLAMADA REAL A RUNPOD
    // (la dejás como está en tu proyecto)
    // ---------------------------------------------------
    // const rp = await fetch(...)
    // const rpJson = await rp.json()
    // await admin.from("video_jobs").update({
    //   status: "RUNNING",
    //   provider_status: rpJson.status,
    //   provider_request_id: rpJson.id,
    // }).eq("id", job.id);

    return res.status(200).json({
      ok: true,
      job_id: job.id,
      status: "QUEUED",
    });
  } catch (err) {
    console.error("❌ generar-video fatal:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "server_error",
    });
  }
}