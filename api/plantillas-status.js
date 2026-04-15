// api/plantillas-status.js
// ─────────────────────────────────────────────────────────────
// Polling del status de un job de plantilla (Seedance via PiAPI).
//
// Cuando PiAPI completa el video:
//   1. Si hay narración → genera audio con ElevenLabs
//   2. Mezcla video + audio con fal-ai/ffmpeg-api (narración en off)
//      NO es lip sync — es narración sobre el video completo
//   3. Sube video final a Supabase Storage (bucket "videos")
//   4. Actualiza video_jobs con COMPLETED + output_url
//
// Si NO hay narración → sube el video de PiAPI directo a Storage.
// ─────────────────────────────────────────────────────────────
import { requireUser }  from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
import { fal }          from "@fal-ai/client";

const PIAPI_TASK_URL  = "https://api.piapi.ai/api/v1/task";
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const VIDEO_BUCKET    = "videos";
const BUCKET_PUBLIC   = String(process.env.SUPABASE_VIDEO_BUCKET_PUBLIC ?? "true").toLowerCase() === "true";

const FAL_KEY            = process.env.FAL_KEY || null;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || null;

if (FAL_KEY) fal.config({ credentials: FAL_KEY });

// ── Voces ElevenLabs ──────────────────────────────────────────
const VOICE_MAP = {
  neutro:       { mujer: "htFfPSZGJwjBv1CL0aMD", hombre: "htFfPSZGJwjBv1CL0aMD" },
  guatemalteco: { mujer: "MbMvLOFbicjtQwgx0j2r", hombre: "htFfPSZGJwjBv1CL0aMD" },
  colombiano:   { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  mexicano:     { mujer: "MPAa8GSBiMLjMLVwn0Hq", hombre: "1IVWxPHWEi1qouA3cAop" },
  argentino:    { mujer: "6Mo5ciGH5nWiQacn5FYk", hombre: "JNcXxzrlvFDXcrGo2b47" },
  español:      { mujer: "qHkrJuifPpn95wK3rm2A", hombre: "o2vbTbO3g4GrKUg7rehy" },
  ingles:       { mujer: "DXFkLCBUTmvXpp2QwZjA", hombre: "sB7vwSCyX0tQmU24cW2C" },
};

function getVoiceId(accent, gender) {
  const a = (accent || "neutro").toLowerCase().trim();
  const g = (gender || "mujer").toLowerCase().trim() === "hombre" ? "hombre" : "mujer";
  return (VOICE_MAP[a] || VOICE_MAP["neutro"])[g] || VOICE_MAP["neutro"]["mujer"];
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Descargar URL a Buffer ────────────────────────────────────
async function fetchUrlToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Subir video a Supabase Storage ────────────────────────────
async function uploadToStorage(sb, userId, jobId, buf, suffix = "") {
  const filePath = `${userId}/${jobId}${suffix}.mp4`;
  const { error } = await sb.storage
    .from(VIDEO_BUCKET)
    .upload(filePath, buf, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  if (BUCKET_PUBLIC) {
    const { data } = sb.storage.from(VIDEO_BUCKET).getPublicUrl(filePath);
    return data?.publicUrl || null;
  } else {
    const { data, error: signErr } = await sb.storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);
    if (signErr) throw new Error(`Signed URL failed: ${signErr.message}`);
    return data?.signedUrl || null;
  }
}

// ── ElevenLabs: generar narración ─────────────────────────────
async function generateElevenLabsAudio(text, accent, gender) {
  if (!ELEVENLABS_API_KEY) { console.error("[plantillas-status] No ELEVENLABS_API_KEY"); return null; }
  if (!text?.trim())        { return null; }

  const voiceId = getVoiceId(accent, gender);
  console.error(`[plantillas-status] ElevenLabs voice=${voiceId} accent=${accent} gender=${gender}`);

  try {
    const r = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_API_KEY },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true },
      }),
    });
    if (!r.ok) { console.error(`[plantillas-status] ElevenLabs error ${r.status}`); return null; }
    const buf = Buffer.from(await r.arrayBuffer());
    console.error("[plantillas-status] ✅ audio ElevenLabs generado");
    return buf;
  } catch (e) { console.error("[plantillas-status] ElevenLabs exception:", e?.message); return null; }
}

// ── fal: subir audio y mezclar con video (narración en off) ───
async function mixNarrationWithVideo(videoUrl, audioBuf) {
  if (!FAL_KEY) { console.error("[plantillas-status] No FAL_KEY para mezcla"); return null; }

  try {
    fal.config({ credentials: FAL_KEY });

    // Subir audio a fal storage
    const audioBlob = new Blob([audioBuf], { type: "audio/mpeg" });
    const audioFile = new File([audioBlob], "narration.mp3", { type: "audio/mpeg" });
    const audioUpload = await fal.storage.upload(audioFile);
    const audioUrl    = audioUpload?.url || audioUpload;

    console.error("[plantillas-status] audio subido a fal:", audioUrl);
    console.error("[plantillas-status] mezclando con video:", videoUrl);

    // fal-ai/ffmpeg-api/merge-audio-video
    // video_url: video mudo de Seedance
    // audio_url: narración de ElevenLabs
    const result = await fal.subscribe("fal-ai/ffmpeg-api/merge-audio-video", {
      input: {
        video_url: videoUrl,
        audio_url: audioUrl,
      },
      pollInterval: 3000,
    });

    const finalUrl =
      result?.data?.video?.url  ||
      result?.video?.url        ||
      result?.data?.video_url   ||
      result?.video_url         ||
      null;

    if (!finalUrl) throw new Error("fal merge-audio-video no devolvió URL");

    console.error("[plantillas-status] ✅ mezcla completada:", finalUrl);
    return finalUrl;
  } catch (e) {
    console.error("[plantillas-status] mixNarrationWithVideo falló:", e?.message);
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

    // Buscar job
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
    console.error(`[plantillas-status] jobId=${jobId} piStatus=${piStatus}`);
    console.error(`[plantillas-status] output:`, JSON.stringify(piData?.data?.output || {}).slice(0, 400));

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

      // Extraer URL del video de PiAPI
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
        return res.status(200).json({
          ok: false, status: "FAILED",
          error: "Video generado pero URL no encontrada. Contacta soporte.",
        });
      }

      const payload        = job.payload || {};
      const narracionTexto = payload.narration_text || payload.textos?.narracion || "";
      const accent         = payload.accent   || "neutro";
      const gender         = payload.gender   || "mujer";
      const plantillaId    = payload.plantilla_id || "plantilla";

      let finalVideoUrl = piVideoUrl; // fallback siempre es el video de PiAPI

      // ── CON NARRACIÓN ──────────────────────────────────────
      if (narracionTexto?.trim()) {
        console.error(`[plantillas-status] procesando narración: "${narracionTexto.slice(0, 60)}..."`);

        // 1. Generar audio ElevenLabs
        await sb.from("video_jobs")
          .update({ provider_status: "elevenlabs_processing" })
          .eq("id", jobId);

        const audioBuf = await generateElevenLabsAudio(narracionTexto, accent, gender);

        if (audioBuf) {
          // 2. Mezclar narración con video via fal ffmpeg-api
          await sb.from("video_jobs")
            .update({ provider_status: "mixing_audio" })
            .eq("id", jobId);

          const mixedUrl = await mixNarrationWithVideo(piVideoUrl, audioBuf);

          if (mixedUrl) {
            // 3. Descargar video mezclado y subir a Storage
            try {
              const buf     = await fetchUrlToBuffer(mixedUrl);
              const savedUrl = await uploadToStorage(sb, user.id, jobId, buf, "_narrado");
              if (savedUrl) finalVideoUrl = savedUrl;
            } catch (e) {
              console.error("[plantillas-status] upload mezclado falló:", e?.message);
              // fallback: intentar subir el video de PiAPI sin audio
            }
          } else {
            console.error("[plantillas-status] mezcla falló — entregando video sin audio");
          }
        } else {
          console.error("[plantillas-status] ElevenLabs falló — entregando video sin audio");
        }
      }

      // ── SIN NARRACIÓN o como fallback ──────────────────────
      // Si finalVideoUrl sigue siendo piVideoUrl (mezcla falló o no hay narración)
      // subimos el video original de PiAPI a Storage
      if (finalVideoUrl === piVideoUrl) {
        try {
          await sb.from("video_jobs")
            .update({ provider_status: "uploading" })
            .eq("id", jobId);

          const buf      = await fetchUrlToBuffer(piVideoUrl);
          const savedUrl = await uploadToStorage(sb, user.id, jobId, buf);
          if (savedUrl) finalVideoUrl = savedUrl;
        } catch (e) {
          console.error("[plantillas-status] upload video original falló:", e?.message);
          // Dejar finalVideoUrl como URL directa de PiAPI
        }
      }

      // Marcar como completado
      await sb.from("video_jobs").update({
        status:          "COMPLETED",
        provider_status: "completed",
        output_url:      finalVideoUrl,
        completed_at:    new Date().toISOString(),
        payload: {
          ...payload,
          video_url:       finalVideoUrl,
          piapi_video_url: piVideoUrl,
        },
      }).eq("id", jobId);

      return res.status(200).json({
        ok: true, status: "COMPLETED", videoUrl: finalVideoUrl,
      });
    }

    // Estado desconocido — log y seguir esperando
    console.warn(`[plantillas-status] piStatus desconocido: "${piStatus}"`);
    console.warn(`[plantillas-status] piData:`, JSON.stringify(piData).slice(0, 600));
    return res.status(200).json({ ok: true, status: "IN_PROGRESS" });

  } catch (e) {
    console.error("[plantillas-status] ERROR:", e?.message || e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}

export const config = {
  runtime:     "nodejs",
  maxDuration: 300,
};