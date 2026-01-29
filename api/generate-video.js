// ---------------------------------------------------------
// API: Generar Video (T2V / I2V)
// Inserta job en Supabase y luego lanza RunPod
// ---------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

// URLs y keys desde variables de entorno
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

// ⚠️ IMPORTANTE: Service Role (no anon)
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod
const RUNPOD_API_KEY =
  process.env.RUNPOD_API_KEY || process.env.VIDEO_RUNPOD_API_KEY;

const RUNPOD_ENDPOINT_ID =
  process.env.RUNPOD_ENDPOINT_ID;

// ---------------------------------------------------------
// Handler principal
// ---------------------------------------------------------
export default async function handler(req, res) {
  try {
    // Solo permitimos POST
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed",
      });
    }

    // Validaciones básicas
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase configuration",
      });
    }

    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
      return res.status(500).json({
        ok: false,
        error: "Missing RunPod configuration",
      });
    }

    // Cliente Supabase con SERVICE ROLE (bypassa RLS)
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false },
      }
    );

    // Acepta body plano o body.input
    const body = req.body?.input ? req.body : { input: req.body };
    const input = body.input || {};

    // Campos del video
    const prompt = (input.prompt || "").trim();
    const negative = input.negative || "";
    const mode = input.mode || "t2v";

    const seconds = Number(input.seconds ?? 3);
    const fps = Number(input.fps ?? 24);
    const width = Number(input.width ?? 640);
    const height = Number(input.height ?? 360);

    // Prompt es obligatorio
    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "Missing prompt",
      });
    }

    // -----------------------------------------------------
    // 1) INSERTAR JOB EN SUPABASE (PASO CRÍTICO)
    // -----------------------------------------------------
    const { data: job, error: insertError } = await supabase
      .from("video_jobs")
      .insert({
        status: "QUEUED",
        prompt,
        negative,
        mode,
        seconds,
        fps,
        width,
        height,
      })
      .select("*")
      .single();

    // Si falla aquí → el front nunca encontrará el row
    if (insertError || !job?.id) {
      return res.status(500).json({
        ok: false,
        error: "Failed to insert video_jobs row",
        detail: insertError?.message,
      });
    }

    // -----------------------------------------------------
    // 2) ENVIAR JOB A RUNPOD
    // -----------------------------------------------------
    const runpodUrl = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`;

    const runpodResponse = await fetch(runpodUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({
        input: {
          // ⚠️ ESTE ID ES CLAVE PARA EL STATUS
          job_id: job.id,

          mode,
          prompt,
          negative,
          seconds,
          fps,
          width,
          height,
        },
      }),
    });

    const runpodJson = await runpodResponse.json().catch(() => null);

    // Si RunPod falla → marcamos FAILED
    if (!runpodResponse.ok || !runpodJson?.id) {
      await supabase
        .from("video_jobs")
        .update({
          status: "FAILED",
          error: runpodJson?.error || "RunPod run failed",
        })
        .eq("id", job.id);

      return res.status(500).json({
        ok: false,
        error: "RunPod execution failed",
        runpod: runpodJson,
      });
    }

    // -----------------------------------------------------
    // 3) ACTUALIZAR JOB COMO RUNNING
    // -----------------------------------------------------
    await supabase
      .from("video_jobs")
      .update({
        status: "RUNNING",
        runpod_request_id: runpodJson.id,
      })
      .eq("id", job.id);

    // Respuesta al frontend
    return res.status(200).json({
      ok: true,
      job_id: job.id,
      runpod_request_id: runpodJson.id,
      status: "RUNNING",
    });

  } catch (err) {
    // Error inesperado
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unknown server error",
    });
  }
}