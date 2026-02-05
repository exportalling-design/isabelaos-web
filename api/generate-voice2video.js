import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

function pickVoice2VideoEndpointId() {
  return process.env.VOICE2VIDEO_RUNPOD_ENDPOINT_ID || null;
}

async function runpodRun({ endpointId, input }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing VOICE2VIDEO_RUNPOD_ENDPOINT_ID");

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
  return data;
}

const clampInt = (v, lo, hi, d) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(lo, Math.min(hi, Math.round(n)));
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const text = String(body?.text || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "Falta text" });

    const seconds = clampInt(body?.seconds ?? body?.duration_s ?? 3, 3, 5, 3) < 4 ? 3 : 5;
    const maxChars = seconds === 3 ? 45 : 80;
    const safeText = text.length > maxChars ? text.slice(0, maxChars) : text;

    const voice = String(body?.voice || "female").toLowerCase().trim(); // female|male
    const lang = String(body?.lang || "es").toLowerCase().trim(); // es|en

    const video_b64 = body?.video_b64 ? String(body.video_b64) : null;
    const video_url = body?.video_url ? String(body.video_url).trim() : null;

    if (!video_b64 && !video_url) {
      return res.status(400).json({ ok: false, error: "Missing video_b64 or video_url" });
    }

    // ✅ 1) spend jades (12)
    const ref = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: 12,
      p_reason: "voice_to_video",
      p_ref: ref,
    });

    if (spendErr) {
      return res.status(400).json({ ok: false, error: `Jades spend failed: ${spendErr.message}` });
    }

    // ✅ 2) create job (sin schema changes)
    const jobId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const jobRow = {
      id: jobId,
      user_id: userId,
      status: "QUEUED",
      mode: "voice_to_video",
      prompt: safeText, // reutilizamos prompt para ver rápido en DB
      negative_prompt: "",

      width: null,
      height: null,
      fps: null,
      num_frames: null,
      steps: null,
      guidance_scale: null,

      payload: body ? JSON.stringify(body) : null,
      provider: "runpod",
    };

    const { error: insErr } = await supabaseAdmin.from("video_jobs").insert(jobRow);
    if (insErr) {
      return res.status(400).json({ ok: false, error: `video_jobs insert failed: ${insErr.message}` });
    }

    // ✅ 3) dispatch runpod
    const endpointId = pickVoice2VideoEndpointId();

    const rpInput = {
      ping: "voice_to_video",
      mode: "voice_to_video",
      job_id: jobId,
      user_id: userId,

      text: safeText,
      seconds,
      voice: voice === "male" ? "male" : "female",
      lang: lang === "en" ? "en" : "es",

      video_b64,
      video_url,
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
      job_id: jobId,
      provider_request_id: runpodId,
      seconds,
      max_chars: maxChars,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Server error" });
  }
      }
