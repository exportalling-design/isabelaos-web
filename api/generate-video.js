// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ✅ Importante si mandas image_base64 (payload grande)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // -----------------------------
    // 0) Auth (obligatorio)
    // -----------------------------
    const token = getBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    }

    // -----------------------------
    // 1) Supabase Admin (server)
    // -----------------------------
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel env",
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ✅ verifica token y saca user.id
    const { data: uData, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !uData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid session", detail: uErr?.message });
    }

    const user_id = uData.user.id;

    // -----------------------------
    // 2) Params
    // -----------------------------
    const {
      mode = "t2v",
      prompt,
      negative_prompt = "",
      height,
      width,
      num_frames,
      fps,
      steps,
      guidance_scale,
      image_base64,
    } = req.body || {};

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // -----------------------------
    // 3) WorkerBase (NO viene del frontend)
    // -----------------------------
    // ✅ En opción A, el frontend no manda workerBase.
    // Tú lo controlas por ENV o por tu "flow" de pods.
    //
    // Si tu flujo crea pods por job, aquí normalmente
    // obtienes/creas el pod y calculas workerBase.
    //
    // Para no tocar tu flow actual, dejamos:
    // - Si ya tienes workerBase dinámico en otro archivo, úsalo ahí
    // - Si NO, usa ENV: WORKER_BASE = https://{podId}-8000.proxy.runpod.net
    //
    const WORKER_BASE = (process.env.WORKER_BASE || "").replace(/\/+$/, "");
    if (!WORKER_BASE) {
      return res.status(400).json({
        ok: false,
        error: "Missing WORKER_BASE env set",
        hint: "Set WORKER_BASE in Vercel env to: https://{podId}-8000.proxy.runpod.net",
      });
    }

    // -----------------------------
    // 4) Crea job en DB (ASYNC)
    // -----------------------------
    const job_id = crypto.randomUUID();

    // Ajusta nombres de columnas a tu tabla real:
    // Recomendado en video_jobs:
    // id (uuid), user_id, status, mode, prompt, negative_prompt,
    // steps, height, width, num_frames, fps, guidance_scale,
    // worker_base, error, created_at, updated_at
    const jobRow = {
      id: job_id,
      user_id,
      status: "IN_QUEUE",
      mode,
      prompt,
      negative_prompt,
      steps: steps ?? 25,
      height: height ?? null,
      width: width ?? null,
      num_frames: num_frames ?? null,
      fps: fps ?? null,
      guidance_scale: guidance_scale ?? null,
      worker_base: WORKER_BASE,
      error: null,
    };

    const ins = await sb.from("video_jobs").insert(jobRow);
    if (ins.error) {
      return res.status(500).json({
        ok: false,
        error: "Failed to create video job",
        detail: ins.error.message,
      });
    }

    // -----------------------------
    // 5) “Dispatch” rápido (NO esperar generación)
    // -----------------------------
    // ✅ La idea: solo “arrancar” el proceso y salir.
    // Tu worker debe aceptar rápido (enqueue).
    // Si tu worker todavía genera síncrono en /api/video_async,
    // NO lo llames aquí con espera, porque vuelves al 524.
    //
    // Por eso en Opción A: /api/video_async debe ser “submit/ack”.
    // Si ya lo tienes así, perfecto.
    // Si no, igualmente dejamos el dispatch con timeout CORTO (2s)
    // solo para intentar "kick" sin colgar Vercel.
    const submitUrl = `${WORKER_BASE}/api/video_async`;

    const submitPayload = {
      job_id, // ✅ importante para que el worker reporte/guarde por job
      mode,
      user_id,
      prompt,
      negative_prompt,
      height,
      width,
      num_frames,
      fps,
      steps,
      guidance_scale,
      image_base64,
    };

    let dispatched = false;
    let dispatch_error = null;

    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2000); // 2s máximo
      const r = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitPayload),
        signal: ac.signal,
      });
      clearTimeout(t);

      // Si respondió rápido, lo marcamos como DISPATCHED.
      if (r.ok) dispatched = true;
      else {
        const txt = await r.text().catch(() => "");
        dispatch_error = `Worker submit failed (${r.status}): ${txt}`;
      }
    } catch (e) {
      dispatch_error = String(e?.message || e);
    }

    if (dispatched) {
      await sb.from("video_jobs").update({ status: "DISPATCHED", error: null }).eq("id", job_id);
    } else if (dispatch_error) {
      // dejamos en IN_QUEUE pero guardamos error para ver en /api/video-status
      await sb.from("video_jobs").update({ error: dispatch_error }).eq("id", job_id);
    }

    // ✅ Respuesta inmediata (lo que evita el 524)
    return res.status(200).json({
      ok: true,
      job_id,
      status: dispatched ? "DISPATCHED" : "IN_QUEUE",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}