// api/generate-video.js
import { createClient } from "@supabase/supabase-js";

// Supabase
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod
const RUNPOD_API_KEY =
  process.env.RUNPOD_API_KEY ||
  process.env.RP_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_KEY;

const RUNPOD_ENDPOINT_ID =
  process.env.RP_WAN22_T2V_ENDPOINT ||          // ✅ TU variable (ideal)
  process.env.VIDEO_RUNPOD_ENDPOINT_ID ||       // ✅ TU variable
  process.env.VIDEO_RUNPOD_ENDPOINT ||          // fallback
  process.env.RUNPOD_ENDPOINT;                  // fallback

const COST_VIDEO_PROMPT = parseInt(process.env.COST_VIDEO_PROMPT || "10", 10);

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserIdFromRequest(req) {
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

function runpodRunUrl(endpointIdOrUrl) {
  const v = String(endpointIdOrUrl || "").trim();
  if (!v) return null;
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return `https://api.runpod.ai/v2/${v}/run`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  try {
    // DEBUG: si algo falta, aquí mismo lo verás en respuesta
    if (!SUPABASE_URL) return json(res, 500, { ok: false, error: "Missing SUPABASE_URL" });
    if (!SUPABASE_SERVICE_ROLE_KEY) return json(res, 500, { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" });
    if (!SUPABASE_ANON_KEY) return json(res, 500, { ok: false, error: "Missing SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)" });

    if (!RUNPOD_API_KEY) return json(res, 500, { ok: false, error: "Missing RUNPOD_API_KEY / RP_API_KEY" });
    if (!RUNPOD_ENDPOINT_ID) return json(res, 500, { ok: false, error: "Missing RP_WAN22_T2V_ENDPOINT / VIDEO_RUNPOD_ENDPOINT_ID" });

    const userId = await getUserIdFromRequest(req);
    if (!userId) return json(res, 401, { ok: false, error: "Unauthorized (no user)" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const prompt = String(body?.prompt || "").trim();
    const negative = String(body?.negative || "").trim();

    const width = parseInt(body?.width || "1080", 10);
    const height = parseInt(body?.height || "1920", 10);
    const fps = parseInt(body?.fps || "24", 10);
    const seconds = parseInt(body?.seconds || "3", 10);
    const frames = Math.max(1, fps * seconds);

    if (!prompt) return json(res, 400, { ok: false, error: "Missing prompt" });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Insert job (QUEUED)
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

    // 2) Spend jades (RPC)
    const { error: spendErr } = await admin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: COST_VIDEO_PROMPT,
      p_reason: "video_prompt",
      p_ref: String(jobId),
    });

    if (spendErr) {
      await admin.from("video_jobs").update({ status: "FAILED", provider_status: "SPEND_FAILED" }).eq("id", jobId);
      return json(res, 402, { ok: false, error: "Jades spend failed", details: spendErr.message });
    }

    // 3) RunPod submit
    const runUrl = runpodRunUrl(RUNPOD_ENDPOINT_ID);

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
      .update({ provider_status: "SUBMITTED", provider_request_id: providerRequestId })
      .eq("id", jobId);

    return json(res, 200, { ok: true, job_id: jobId, provider_request_id: providerRequestId });
  } catch (e) {
    // Si aquí explota, YA NO te quedas sin info.
    return json(res, 500, { ok: false, error: "Server error", details: String(e?.message || e) });
  }
}