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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const {
      mode = "t2v",
      user_id,
      prompt,
      negative_prompt = "",
      height,
      width,
      num_frames,
      fps,
      steps,
      guidance_scale,
      image_base64,
      workerBase, // ✅ si tu backend ya lo calcula, puedes enviarlo; si no, usa ENV
    } = req.body || {};

    if (!user_id) return res.status(400).json({ ok: false, error: "Missing user_id" });
    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // -----------------------------
    // 1) Supabase client (server)
    // -----------------------------
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_BUCKET =
      process.env.SUPABASE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || "generations";

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel env",
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // -----------------------------
    // 2) Worker URL
    // -----------------------------
    // ✅ Prioridad:
    //  - workerBase del body (si tu flujo ya lo calcula)
    //  - o ENV fijo (si estás usando un pod fijo)
    const workerBaseFinal =
      workerBase || process.env.WORKER_BASE || process.env.RUNPOD_WORKER_BASE;

    if (!workerBaseFinal) {
      return res.status(400).json({
        ok: false,
        error: "Missing workerBase (RunPod worker base URL) and no WORKER_BASE env set",
      });
    }

    // ✅ Normaliza para evitar doble slash
    const wb = String(workerBaseFinal).replace(/\/+$/, "");
    const workerUrl = `${wb}/api/video_async`;

    // -----------------------------
    // 3) Call worker and get MP4 binary
    // -----------------------------
    const payload = {
      mode,
      user_id, // el worker puede ignorarlo; aquí lo usamos para folder en Storage
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

    // ✅ Timeout para evitar colgadas infinitas
    const ac = new AbortController();
    const timeoutMs = Number(process.env.WORKER_TIMEOUT_MS || 15 * 60 * 1000); // 15 min
    const t = setTimeout(() => ac.abort(), timeoutMs);

    const r = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    }).catch((err) => {
      throw new Error(`Worker fetch failed: ${String(err?.message || err)}`);
    });

    clearTimeout(t);

    if (!r.ok) {
      let detail = "";
      try {
        detail = await r.text();
      } catch {}
      return res.status(502).json({
        ok: false,
        error: `Worker error (${r.status})`,
        detail,
        workerUrl,
      });
    }

    // ✅ esperamos MP4 binario
    const mp4ArrayBuffer = await r.arrayBuffer();
    const mp4Bytes = Buffer.from(mp4ArrayBuffer);

    if (!mp4Bytes || mp4Bytes.length < 200) {
      return res.status(502).json({
        ok: false,
        error: "Worker returned empty/too small MP4",
        bytes: mp4Bytes?.length || 0,
        workerUrl,
      });
    }

    // -----------------------------
    // 4) Upload to Supabase Storage (desde Vercel)
    // -----------------------------
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");

    const fileKey = `${user_id}/${yyyy}/${mm}/${crypto.randomUUID()}.mp4`;

    const up = await sb.storage.from(SUPABASE_BUCKET).upload(fileKey, mp4Bytes, {
      contentType: "video/mp4",
      upsert: false,
    });

    if (up.error) {
      return res.status(500).json({
        ok: false,
        error: "Supabase upload failed",
        detail: up.error.message,
        bucket: SUPABASE_BUCKET,
        key: fileKey,
      });
    }

    // ✅ signed url 7 días
    const signed = await sb.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(fileKey, 60 * 60 * 24 * 7);

    let video_url = null;
    if (signed?.data?.signedUrl) {
      video_url = signed.data.signedUrl;
    } else {
      const pub = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(fileKey);
      video_url = pub?.data?.publicUrl || null;
    }

    return res.status(200).json({
      ok: true,
      mode,
      bucket: SUPABASE_BUCKET,
      key: fileKey,
      video_url,
      bytes: mp4Bytes.length,
      workerUrl,
    });
  } catch (e) {
    const msg = String(e?.message || e);

    if (msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort")) {
      return res.status(504).json({ ok: false, error: "Worker timeout", detail: msg });
    }

    return res.status(500).json({ ok: false, error: msg });
  }
}