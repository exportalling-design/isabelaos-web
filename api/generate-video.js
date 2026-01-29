// api/generate-video.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod (usa uno de estos)
const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;
const RUNPOD_ENDPOINT = process.env.VIDEO_RUNPOD_ENDPOINT || process.env.RUNPOD_VIDEO_ENDPOINT || process.env.RUNPOD_ENDPOINT;

const COST_VIDEO_PROMPT = parseInt(process.env.COST_VIDEO_PROMPT || "10", 10);

function json(res, code, obj) {
  res.status(code).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserIdFromRequest(req) {
  // usamos el JWT del usuario para obtener su id (NO service role)
  const jwt = getBearerToken(req);
  if (!jwt) return null;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) return null;
  return data?.user?.id || null;
}

function buildRunpodRunUrl(endpointOrUrl) {
  if (!endpointOrUrl) return null;
  const v = String(endpointOrUrl).trim();
  if (v.startsWith("http://") || v.startsWith("https://")) return v; // ya viene URL completa
  // si solo viene el ID del endpoint:
  return `https://api.runpod.ai/v2/${v}/run`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }
    if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT) {
      return json(res, 500, { ok: false, error: "Missing RUNPOD_API_KEY or VIDEO_RUNPOD_ENDPOINT" });
    }

    const userId = await getUserIdFromRequest(req);
    if (!userId) return json(res, 401, { ok: false, error: "Unauthorized (no user)" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const prompt = String(body?.prompt || "").trim();
    const negative = String(body?.negative || "").trim();

    const width = parseInt(body?.width || "1080", 10);
    const height = parseInt(body?.height || "1920", 10);
    const fps = parseInt(body?.fps || "24", 10);
    const seconds = parseInt(body?.seconds || "3", 10);

    // frames = fps * seconds
    const frames = Math.max(1, fps * seconds);

    if (!prompt) return json(res, 400, { ok: false, error: "Missing prompt" });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Crear job en DB primero (QUEUED)
    const insertPayload = {
      user_id: userId,
      status: "QUEUED",
      prompt,
      negative_prompt: negative || null,
      width,
      height,
      fps,
      seconds,
      frames,
      provider: "runpod",
      provider_status: "CREATED",
      video_url: null,
    };

    const { data: jobRow, error: insErr } = await admin
      .from("video_jobs")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insErr) {
      return json(res, 500, { ok: false, error: "video_jobs insert failed", details: insErr.message });
    }

    const jobId = jobRow.id;

    // 2) Cobrar jades (tu RPC)
    const { error: spendErr } = await admin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: COST_VIDEO_PROMPT,
      p_reason: "video_prompt",
      p_ref: String(jobId),
    });

    if (spendErr) {
      // rollback del job (opcional)
      await admin.from("video_jobs").update({ status: "FAILED", provider_status: "SPEND_FAILED" }).eq("id", jobId);
      return json(res, 402, { ok: false, error: "Jades spend failed", details: spendErr.message });
    }

    // 3) Mandar a RunPod
    const runUrl = buildRunpodRunUrl(RUNPOD_ENDPOINT);
    const rpResp = await fetch(runUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({
        input: {
          job_id: String(jobId),
          user_id: String(userId),
          prompt,
          negative: negative || "",
          width,
          height,
          fps,
          seconds,
          frames,
        },
      }),
    });

    const rpJson = await rpResp.json().catch(() => ({}));
    if (!rpResp.ok) {
      await admin
        .from("video_jobs")
        .update({ status: "FAILED", provider_status: "RUNPOD_SUBMIT_FAILED", provider_error: JSON.stringify(rpJson) })
        .eq("id", jobId);

      return json(res, 500, { ok: false, error: "RunPod submit failed", details: rpJson });
    }

    const providerRequestId = rpJson?.id || rpJson?.requestId || rpJson?.jobId || null;

    await admin
      .from("video_jobs")
      .update({
        status: "QUEUED",
        provider_status: "SUBMITTED",
        provider_request_id: providerRequestId,
      })
      .eq("id", jobId);

    return json(res, 200, {
      ok: true,
      job_id: jobId,
      provider_request_id: providerRequestId,
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}