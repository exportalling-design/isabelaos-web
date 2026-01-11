// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser } from "./_auth";

// ✅ Importante si mandas image_base64 (payload grande)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ✅ Worker base fijo por ENV (Opción A)
// Ej: https://{PODID}-8000.proxy.runpod.net
const WORKER_BASE = (process.env.WORKER_BASE || "").replace(/\/+$/, "");

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // -----------------------------
    // 0) Auth -> user_id real
    // -----------------------------
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    const user_id = auth.user.id;

    // -----------------------------
    // 1) Params
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
    // 2) Worker base (ENV)
    // -----------------------------
    if (!WORKER_BASE) {
      return res.status(400).json({
        ok: false,
        error: "Missing WORKER_BASE env set",
        hint: "Set WORKER_BASE in Vercel env to: https://{podId}-8000.proxy.runpod.net",
      });
    }

    const worker_url = `${WORKER_BASE}/api/video_async`;

    // -----------------------------
    // 3) Create job row in video_jobs
    // -----------------------------
    const sb = sbAdmin();
    const job_id = crypto.randomUUID();

    const { error: insErr } = await sb.from("video_jobs").insert({
      job_id,
      user_id,
      status: "IN_QUEUE",
      video_url: null,
      error: null,
      pod_id: null,         // opcional
      worker_url,           // ✅ te sirve para debug
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (insErr) {
      return res.status(500).json({ ok: false, error: "Failed to create job", detail: insErr.message });
    }

    // -----------------------------
    // 4) Dispatch rápido al worker (NO esperar render)
    // -----------------------------
    const submitPayload = {
      job_id, // ✅ crucial para que el worker actualice ESTA fila
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
    let dispatch_detail = null;

    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2000); // 2s máximo
      const r = await fetch(worker_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitPayload),
        signal: ac.signal,
      });
      clearTimeout(t);

      if (r.ok) {
        dispatched = true;
      } else {
        const txt = await r.text().catch(() => "");
        dispatch_detail = `Worker submit failed (${r.status}): ${txt}`;
      }
    } catch (e) {
      dispatch_detail = String(e?.message || e);
    }

    // Actualiza estado sin romper (no bloquea la respuesta)
    if (dispatched) {
      await sb
        .from("video_jobs")
        .update({ status: "DISPATCHED", error: null, updated_at: new Date().toISOString() })
        .eq("job_id", job_id);
    } else if (dispatch_detail) {
      await sb
        .from("video_jobs")
        .update({ error: dispatch_detail, updated_at: new Date().toISOString() })
        .eq("job_id", job_id);
    }

    // ✅ Respuesta inmediata (evita 524)
    return res.status(200).json({
      ok: true,
      job_id,
      status: dispatched ? "DISPATCHED" : "IN_QUEUE",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}