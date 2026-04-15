// api/plantillas-status.js
// ─────────────────────────────────────────────────────────────
// Polling del status de un job de plantilla (Seedance via PiAPI).
//
// Cuando el job termina en PiAPI:
//   1. Guarda la URL del video de PiAPI en video_jobs (NO descarga en Vercel)
//   2. Si hay narración → genera audio con ElevenLabs
//   3. Envía video_url + audio_b64 al worker RunPod FFmpeg para mezclar
//   4. RunPod devuelve video final mezclado → sube a Supabase Storage
//   5. Actualiza video_jobs con status COMPLETED + output_url final
//
// Si NO hay narración → sube el video directo de PiAPI a Storage.
// ─────────────────────────────────────────────────────────────
import { requireUser }  from "./_auth.js";
import { createClient } from "@supabase/supabase-js";

const PIAPI_TASK_URL  = "https://api.piapi.ai/api/v1/task";
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const RUNPOD_API_BASE = "https://api.runpod.ai/v2";
const VIDEO_BUCKET    = "videos";

const RUNPOD_ENDPOINT = process.env.RUNPOD_ASSEMBLER_ENDPOINT_ID;
const RUNPOD_API_KEY  = process.env.RUNPOD_API_KEY || process.env.RP_API_KEY;

const VOICE_MAP = {
  neutro:       { mujer: "htFfPSZGJwjBv1CL0aMD", hombre: "htFfPSZGJwjBv1CL0aMD" },
  guatemalteco: { mujer: "MbMvLOFbicjtQwgx0j2r", hombre: "htFfPSZGJwjBv1CL0aMD" },
  colombiano:   { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  mexicano:     { mujer: "MPAa8GSBiMLjMLVwn0Hq", hombre: "1IVWxPHWEi1qouA3cAop" },
  argentino:    { mujer: "6Mo5ciGH5nWiQacn5FYk", hombre: "JNcXxzrlvFDXcrGo2b47" },
  español:      { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  ingles:       { mujer: "DXFkLCBUTmvXpp2QwZjA", hombre: "sB7vwSCyX0tQmU24cW2C" },
};

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getVoiceId(accent, gender) {
  const a = (accent || "neutro").toLowerCase().trim();
  const g = (gender || "mujer").toLowerCase().trim() === "hombre" ? "hombre" : "mujer";
  return (VOICE_MAP[a] || VOICE_MAP["neutro"])[g] || VOICE_MAP["neutro"]["mujer"];
}

// ── ElevenLabs ────────────────────────────────────────────────
async function generateAudio(text, accent, gender) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || !text?.trim()) return null;
  const voiceId = getVoiceId(accent, gender);
  try {
    const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
      }),
    });
    if (!r.ok) { console.error("[plantillas-status] ElevenLabs error:", r.status); return null; }
    const buf = await r.arrayBuffer();
    console.log("[plantillas-status] ✅ audio ElevenLabs generado");
    return Buffer.from(buf).toString("base64");
  } catch (e) { console.error("[plantillas-status] ElevenLabs:", e?.message); return null; }
}

// ── RunPod FFmpeg: mezclar video URL + audio base64 ───────────
async function mixVideoWithAudio(videoUrl, audioBase64) {
  if (!RUNPOD_ENDPOINT || !RUNPOD_API_KEY) {
    console.error("[plantillas-status] RunPod no configurado");
    return null;
  }
  try {
    const submitRes = await fetch(`${RUNPOD_API_BASE}/${RUNPOD_ENDPOINT}/run`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
      body: JSON.stringify({
        input: {
          action:    "mix_audio",
          video_url: videoUrl,
          audio_b64: audioBase64,
        },
      }),
    });
    if (!submitRes.ok) throw new Error(`RunPod submit: ${submitRes.status}`);
    const { id: rpJobId } = await submitRes.json();
    if (!rpJobId) throw new Error("RunPod sin job ID");
    console.log(`[plantillas-status] RunPod mix job: ${rpJobId}`);

    // Polling RunPod máx 5 min
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5000));
      const sr = await fetch(`${RUNPOD_API_BASE}/${RUNPOD_ENDPOINT}/status/${rpJobId}`, {
        headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
      });
      if (!sr.ok) continue;
      const sd = await sr.json();
      if (sd.status === "COMPLETED") {
        if (sd.output?.video_b64) return { base64: sd.output.video_b64 };
        if (sd.output?.video_url) return { url: sd.output.video_url };
        throw new Error("RunPod COMPLETED sin video");
      }
      if (sd.status === "FAILED")    throw new Error(`RunPod FAILED: ${sd.error}`);
      if (sd.status === "CANCELLED") throw new Error("RunPod cancelado");
    }
    throw new Error("RunPod timeout");
  } catch (e) { console.error("[plantillas-status] mixVideoWithAudio:", e?.message); return null; }
}

// ── Subir video a Supabase Storage ────────────────────────────
async function saveToStorage(userId, plantillaId, source) {
  // source: { base64 } | { url } | string (url directa)
  const sb = getSupabaseAdmin();
  try {
    let buf;
    if (typeof source === "string") {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } else if (source?.base64) {
      buf = Buffer.from(source.base64, "base64");
    } else if (source?.url) {
      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      throw new Error("Sin fuente de video válida");
    }

    const filename = `plantilla-${plantillaId}-${Date.now()}.mp4`;
    const path     = `${userId}/${filename}`;

    const { error } = await sb.storage
      .from(VIDEO_BUCKET)
      .upload(path, buf, { contentType: "video/mp4", upsert: false });

    if (error) throw new Error(error.message);

    const { data } = sb.storage.from(VIDEO_BUCKET).getPublicUrl(path);
    console.log(`[plantillas-status] ✅ guardado en biblioteca: ${path}`);
    return data?.publicUrl || null;
  } catch (e) {
    console.error("[plantillas-status] saveToStorage:", e?.message);
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    const user = auth.user;

    const jobId = req.query?.jobId ||
      (typeof req.url === "string" && new URL(req.url, "http://x").searchParams.get("jobId"));
    if (!jobId) return res.status(400).json({ ok: false, error: "MISSING_JOB_ID" });

    const sb = getSupabaseAdmin();

    const { data: job, error: fetchErr } = await sb
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single();

    if (fetchErr || !job) return res.status(404).json({ ok: false, error: "JOB_NOT_FOUND" });

    // Ya completado
    if (job.status === "COMPLETED") {
      return res.status(200).json({
        ok: true, status: "COMPLETED",
        videoUrl: job.output_url || job.payload?.video_url || null,
      });
    }

    // Ya fallido
    if (job.status === "FAILED") {
      return res.status(200).json({
        ok: false, status: "FAILED",
        error: job.provider_error || "El video falló.",
      });
    }

    // Consultar PiAPI
    const taskId = job.provider_request_id || job.payload?.task_id;
    if (!taskId) return res.status(200).json({ ok: true, status: "IN_PROGRESS" });

    const piKey = process.env.PIAPI_KEY;
    if (!piKey)  return res.status(200).json({ ok: true, status: "IN_PROGRESS" });

    let piData;
    try {
      const piRes = await fetch(`${PIAPI_TASK_URL}/${taskId}`, {
        headers: { "x-api-key": piKey },
      });
      if (!piRes.ok) return res.status(200).json({ ok: true, status: "IN_PROGRESS" });
      piData = await piRes.json();
    } catch {
      return res.status(200).json({ ok: true, status: "IN_PROGRESS" });
    }

    const piStatus = (piData?.data?.status || piData?.status || "").toLowerCase();
    console.log(`[plantillas-status] jobId=${jobId} piStatus=${piStatus}`);
    console.log(`[plantillas-status] output keys:`, Object.keys(piData?.data?.output || {}).join(", "));

    // En progreso
    if (["pending", "processing", "running", "queued", "in_progress", "submitted"].includes(piStatus)) {
      return res.status(200).json({ ok: true, status: "IN_PROGRESS" });
    }

    // Fallido
    if (["failed", "error", "cancelled", "canceled"].includes(piStatus)) {
      const errMsg = piData?.data?.error || piData?.error || "Error en el generador de video.";
      await sb.from("video_jobs")
        .update({ status: "FAILED", provider_status: "failed", provider_error: errMsg })
        .eq("id", jobId);
      return res.status(200).json({ ok: false, status: "FAILED", error: errMsg });
    }

    // Completado
    if (["completed", "success", "finished"].includes(piStatus)) {

      // Extraer URL del video
      const piVideoUrl =
        piData?.data?.output?.video_url    ||
        piData?.data?.output?.url          ||
        piData?.data?.output?.video        ||
        piData?.data?.output?.outputs?.[0] ||
        piData?.output?.video_url          ||
        null;

      if (!piVideoUrl) {
        console.error("[plantillas-status] COMPLETED sin URL. Output:", JSON.stringify(piData?.data?.output || piData).slice(0, 500));
        await sb.from("video_jobs")
          .update({ status: "FAILED", provider_error: "Video completado sin URL" })
          .eq("id", jobId);
        return res.status(200).json({ ok: false, status: "FAILED", error: "Video generado pero URL no encontrada. Contacta soporte." });
      }

      const payload        = job.payload || {};
      const narracionTexto = payload.narration_text || payload.textos?.narracion || "";
      const accent         = payload.accent  || "neutro";
      const gender         = payload.gender  || "mujer";
      const plantillaId    = payload.plantilla_id || "plantilla";

      let finalUrl;

      if (narracionTexto?.trim()) {
        // Con narración: ElevenLabs + RunPod mix
        console.log(`[plantillas-status] procesando narración + mezcla de audio`);
        const audioB64  = await generateAudio(narracionTexto, accent, gender);
        const mixResult = audioB64 ? await mixVideoWithAudio(piVideoUrl, audioB64) : null;

        // Si RunPod mix funcionó → guardar mezclado, si no → guardar video solo
        finalUrl = await saveToStorage(user.id, plantillaId, mixResult || piVideoUrl);
      } else {
        // Sin narración: guardar video directo
        finalUrl = await saveToStorage(user.id, plantillaId, piVideoUrl);
      }

      // Si saveToStorage falló → usar URL directa de PiAPI como fallback
      if (!finalUrl) {
        console.warn("[plantillas-status] Storage falló — usando URL directa de PiAPI como fallback");
        finalUrl = piVideoUrl;
      }

      // Actualizar job como completado
      await sb.from("video_jobs").update({
        status:          "COMPLETED",
        provider_status: "completed",
        output_url:      finalUrl,
        completed_at:    new Date().toISOString(),
        payload: { ...payload, video_url: finalUrl, piapi_video_url: piVideoUrl },
      }).eq("id", jobId);

      return res.status(200).json({ ok: true, status: "COMPLETED", videoUrl: finalUrl });
    }

    // Estado desconocido
    console.warn(`[plantillas-status] piStatus desconocido: "${piStatus}"`);
    console.warn(`[plantillas-status] piData completo:`, JSON.stringify(piData).slice(0, 600));
    return res.status(200).json({ ok: true, status: "IN_PROGRESS" });

  } catch (e) {
    console.error("[plantillas-status] ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}

export const config = {
  runtime:     "nodejs",
  maxDuration: 300, // 5 min — necesario para RunPod polling
};