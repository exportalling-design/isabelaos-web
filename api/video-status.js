// api/video-status.js
export const runtime = "nodejs";

import { getSupabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}

async function runpodGetWithRetry(url, apiKey) {
  const r1 = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (r1.status !== 401 && r1.status !== 403) return r1;
  return fetch(url, { headers: { Authorization: apiKey } });
}

function pickVideoFromOutput(out) {
  if (!out) return null;

  // casos comunes
  if (typeof out === "string" && out.startsWith("http")) return { video_url: out };

  const directUrl =
    out.video_url ||
    out.url ||
    out.video ||
    out.result_url;

  if (directUrl && typeof directUrl === "string") return { video_url: directUrl };

  const b64 =
    out.video_b64 ||
    out.video_base64 ||
    out.b64 ||
    out.base64;

  if (b64 && typeof b64 === "string") return { video_b64: b64 };

  // rutas anidadas comunes
  const nested =
    out.output?.video_url ||
    out.output?.url ||
    out.result?.video_url ||
    out.result?.url ||
    out.data?.video_url ||
    out.data?.url;

  if (nested && typeof nested === "string") return { video_url: nested };

  const nestedB64 =
    out.output?.video_b64 ||
    out.output?.video_base64 ||
    out.result?.video_b64 ||
    out.result?.video_base64;

  if (nestedB64 && typeof nestedB64 === "string") return { video_b64: nestedB64 };

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const admin = getSupabaseAdmin();
    const user_id = await getUserIdFromAuthHeader(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const job_id = String(req.query.job_id || "").trim();
    if (!job_id) return res.status(400).json({ ok: false, error: "Missing job_id" });

    const { data: job, error: jobErr } = await admin
      .from("video_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) return res.status(404).json({ ok: false, error: "Job not found" });
    if (job.user_id !== user_id) return res.status(403).json({ ok: false, error: "Forbidden" });

    // Si ya tenemos video_url, devolvemos directo
    if (job.video_url) {
      return res.status(200).json({ ok: true, status: job.status, video_url: job.video_url, job });
    }

    const request_id = job.provider_request_id;
    if (!request_id) {
      return res.status(200).json({ ok: true, status: job.status, note: "No provider_request_id yet", job });
    }

    const apiKey = mustEnv("RUNPOD_API_KEY");
    const endpointId = mustEnv("RUNPOD_ENDPOINT_ID");
    const baseUrl = process.env.RUNPOD_BASE_URL || "https://api.runpod.ai/v2";

    const url = `${baseUrl}/${endpointId}/status/${request_id}`;
    const rpRes = await runpodGetWithRetry(url, apiKey);
    const rpJson = await rpRes.json().catch(() => null);

    // Guardamos raw siempre
    await admin
      .from("video_jobs")
      .update({
        provider_status: rpJson?.status || `HTTP_${rpRes.status}`,
        provider_output: rpJson,
      })
      .eq("id", job_id);

    const status = rpJson?.status || "UNKNOWN";

    // Si RunPod reporta error
    if (status === "FAILED" || rpJson?.error) {
      await admin
        .from("video_jobs")
        .update({
          status: "FAILED",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job_id);

      return res.status(200).json({ ok: true, status: "FAILED", provider: rpJson });
    }

    // Aún trabajando
    if (status === "IN_QUEUE" || status === "IN_PROGRESS" || status === "RUNNING") {
      await admin.from("video_jobs").update({ status: "RUNNING" }).eq("id", job_id);
      return res.status(200).json({ ok: true, status, provider: rpJson });
    }

    // COMPLETADO: buscar video en output
    if (status === "COMPLETED") {
      const found = pickVideoFromOutput(rpJson?.output);

      if (!found) {
        // ESTE es exactamente tu error actual
        return res.status(200).json({
          ok: true,
          status: "COMPLETED",
          error: "No video_b64/video_url in provider output",
          provider: rpJson,
        });
      }

      // Si viene URL directo, lo guardamos
      if (found.video_url) {
        await admin
          .from("video_jobs")
          .update({
            status: "COMPLETED",
            video_url: found.video_url,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job_id);

        return res.status(200).json({ ok: true, status: "COMPLETED", video_url: found.video_url });
      }

      // Si viene b64, lo devolvemos (y opcionalmente lo subís a Storage)
      // Para no inflar DB, NO guardo el b64 en la tabla.
      await admin
        .from("video_jobs")
        .update({
          status: "COMPLETED",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job_id);

      return res.status(200).json({ ok: true, status: "COMPLETED", video_b64: found.video_b64 });
    }

    return res.status(200).json({ ok: true, status, provider: rpJson });
  } catch (err) {
    console.error("❌ video-status fatal:", err);
    return res.status(500).json({ ok: false, error: err?.message || "server_error" });
  }
}