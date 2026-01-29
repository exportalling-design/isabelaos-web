// api/generate-video.js
export const runtime = "nodejs";

import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

function pick(obj, allowedKeys) {
  const out = {};
  for (const k of allowedKeys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

async function getTableColumns(admin, tableName = "video_jobs") {
  // lee columnas reales del schema
  const { data, error } = await admin
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", tableName);

  if (error) throw new Error(`Cannot read schema columns: ${error.message}`);
  return (data || []).map((r) => r.column_name);
}

async function runpodRun({ endpointId, apiKey, input }) {
  const url = `https://api.runpod.ai/v2/${endpointId}/run`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ input }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`RunPod /run failed: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const admin = getSupabaseAdmin();

    // Sanity: confirmar que service role está presente
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing SUPABASE_SERVICE_ROLE_KEY in Vercel env",
      });
    }

    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    const negative_prompt = String(body.negative_prompt || body.negative || "").trim();

    const fps = Number(body.fps || 24);
    const seconds = Number(body.seconds || 3);
    const frames = Number(body.frames || Math.round(fps * seconds));
    const width = Number(body.width || 1080);
    const height = Number(body.height || 1920);
    const steps = Number(body.steps || 25);
    const aspect = String(body.aspect || "9:16");

    if (!prompt) return res.status(400).json({ ok: false, error: "Missing prompt" });

    // 1) columnas reales
    const cols = await getTableColumns(admin, "video_jobs");
    const colset = new Set(cols);

    // 2) payload “ideal”
    const desired = {
      user_id,
      status: "QUEUED",
      prompt,
      negative_prompt,
      provider: "runpod",
      provider_status: "QUEUED",
      provider_request_id: null,
      video_url: null,

      fps,
      seconds,
      frames,
      width,
      height,
      steps,
      aspect,
    };

    // 3) solo lo que existe en tu tabla
    const allowedKeys = Object.keys(desired).filter((k) => colset.has(k));
    const insertPayload = pick(desired, allowedKeys);

    // 4) INSERT
    const { data: job, error: insertErr } = await admin
      .from("video_jobs")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertErr || !job?.id) {
      return res.status(500).json({
        ok: false,
        error: "video_jobs insert failed",
        message: insertErr?.message || null,
        details: insertErr?.details || null,
        hint: insertErr?.hint || null,
        code: insertErr?.code || null,
        insertPayload,
        existingColumns: cols,
      });
    }

    // 5) (opcional) mandar a runpod solo si tienes env
    const endpointId = process.env.RUNPOD_VIDEO_ENDPOINT_ID || null;
    const apiKey = process.env.RUNPOD_API_KEY || null;

    if (!endpointId || !apiKey) {
      // job creado, pero no enviamos a runpod
      return res.status(200).json({
        ok: true,
        job_id: job.id,
        status: job.status || "QUEUED",
        warning: "Job inserted but RUNPOD env missing (RUNPOD_VIDEO_ENDPOINT_ID / RUNPOD_API_KEY)",
        job,
      });
    }

    const rp = await runpodRun({
      endpointId,
      apiKey,
      input: {
        job_id: job.id,
        user_id,
        prompt,
        negative_prompt,
        fps,
        frames,
        seconds,
        width,
        height,
        steps,
        aspect,
      },
    });

    const provider_request_id = rp?.id || null;

    // update si existen esas columnas
    const upd = {};
    if (colset.has("provider_request_id")) upd.provider_request_id = provider_request_id;
    if (colset.has("provider_status")) upd.provider_status = rp?.status || "IN_QUEUE";
    if (colset.has("status")) upd.status = "IN_PROGRESS";

    if (Object.keys(upd).length > 0) {
      await admin.from("video_jobs").update(upd).eq("id", job.id);
    }

    return res.status(200).json({
      ok: true,
      job_id: job.id,
      provider_request_id,
      runpod_status: rp?.status || "IN_QUEUE",
    });
  } catch (err) {
    console.error("generate-video fatal:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}