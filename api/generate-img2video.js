// api/generate-img2video.js
import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.RP_API_KEY ||
  null;

// ✅ endpoint i2v (env)
function pickI2VEndpointId() {
  return (
    process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.IMG2VIDEO_RUNPOD_ENDPOINT ||
    process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
    process.env.VIDEO_RUNPOD_ENDPOINT ||
    null
  );
}

async function runpodRun({ endpointId, input }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing IMG2VIDEO endpoint id env var");

  const url = `https://api.runpod.ai/v2/${endpointId}/run`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ input }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = data?.error || data?.message || JSON.stringify(data);
    throw new Error(`RunPod /run failed: ${r.status} ${msg}`);
  }
  return data; // { id: "..." }
}

const COST_I2V = 12;

// estados activos (para evitar duplicar jobs)
const ACTIVE_STATUSES = ["QUEUED", "DISPATCHED", "IN_PROGRESS", "RUNNING", "PENDING"];

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ MISMO SISTEMA DE AUTH QUE generate-video.js
    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const prompt = String(body?.prompt || "").trim();
    const negative_prompt = String(body?.negative_prompt || body?.negative || "").trim();

    const steps = Number(body?.steps || 25);
    const guidance_scale = Number(body?.guidance_scale || 7.5);

    const fps = Number(body?.fps || 24);
    const seconds = Number(body?.duration_s || body?.seconds || 5);
    const num_frames = Number(body?.num_frames || body?.frames || Math.round(fps * seconds));

    const aspect_ratio = String(body?.aspect_ratio || "").trim(); // "" o "9:16"

    // i2v inputs
    const image_b64 = body?.image_b64 || null;
    const image_url = body?.image_url || null;

    if (!image_b64 && !image_url) {
      return res.status(400).json({ ok: false, error: "Missing image_b64 or image_url" });
    }

    // width/height: si no vienen, se dejan null y el worker decide.
    // Pero si viene aspect_ratio=9:16 y no mandaron width/height, set default vertical.
    let width =
      body?.width !== undefined && body?.width !== null && body?.width !== ""
        ? Number(body.width)
        : null;

    let height =
      body?.height !== undefined && body?.height !== null && body?.height !== ""
        ? Number(body.height)
        : null;

    if (aspect_ratio === "9:16" && (width == null || height == null)) {
      // ✅ default vertical como tu preset (576x1024)
      width = 576;
      height = 1024;
    }

    // ✅ evitar doble cobro si frontend manda already_billed=true
    const alreadyBilled = body?.already_billed === true;

    // ✅ 0) si ya hay job activo i2v, devolvelo (rehidrata)
    const { data: activeJob, error: activeErr } = await supabaseAdmin
      .from("video_jobs")
      .select("id,status,provider_status,provider_request_id,video_url,created_at,updated_at")
      .eq("user_id", userId)
      .eq("mode", "i2v")
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!activeErr && activeJob?.[0]) {
      return res.status(200).json({
        ok: true,
        status: "ALREADY_RUNNING",
        job_id: activeJob[0].id, // ✅ tu video-status usa id
        job: activeJob[0],
      });
    }

    // ✅ 1) cobrar jades (server-side) SOLO si no viene already_billed
    if (!alreadyBilled) {
      const ref = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

      const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
        p_user_id: userId,
        p_amount: COST_I2V,
        p_reason: "img2video",
        p_ref: ref,
      });

      if (spendErr) {
        return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });
      }
    }

    // ✅ 2) crear job con columna id (consistente con video-status.js)
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      mode: "i2v",
      status: "QUEUED",
      provider_status: "queued",
      provider: "runpod",

      prompt,
      negative_prompt,

      width: width ?? null,
      height: height ?? null,

      fps,
      num_frames,
      steps,
      guidance_scale,

      // guarda payload como json (o string si tu columna es jsonb/string)
      payload: body ? JSON.stringify(body) : null,

      video_url: null,
      error: null,
      provider_request_id: null,
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);
    if (insErr) {
      return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ 3) RunPod dispatch
    const endpointId = pickI2VEndpointId();

    const rpInput = {
      mode: "i2v",
      job_id: jobId,
      user_id: userId,
      prompt: prompt || "",
      negative_prompt: negative_prompt || "",
      fps,
      num_frames,
      steps,
      guidance_scale,
      duration_s: seconds,
      image_b64,
      image_url,
      ...(aspect_ratio ? { aspect_ratio } : {}),
      ...(typeof width === "number" && Number.isFinite(width) ? { width } : {}),
      ...(typeof height === "number" && Number.isFinite(height) ? { height } : {}),
    };

    const rp = await runpodRun({ endpointId, input: rpInput });
    const runpodId = rp?.id || rp?.jobId || rp?.request_id || null;

    if (runpodId) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          provider_request_id: String(runpodId),
          provider_status: "submitted",
          status: "IN_PROGRESS",
          started_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    return res.status(200).json({
      ok: true,
      status: "IN_PROGRESS",
      job_id: jobId,
      provider_request_id: runpodId,
      already_billed: alreadyBilled,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
}