// api/video-status.js ✅ COMPLETO (cola + dispatch + release slot)
// - Polling desde frontend: /api/video-status?job_id=...
// - Si está QUEUED intenta reservar slot y despachar a RunPod.
// - Si está IN_PROGRESS consulta RunPod status.
// - En DONE/FAILED libera slot SIEMPRE (RPC release_video_slot).
// - No toca tu módulo de imágenes.

import { supabaseAdmin } from "../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../src/lib/getUserIdFromAuth.js";

const RUNPOD_API_KEY =
  process.env.RP_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.VIDEO_RUNPOD_API_KEY ||
  null;

const VIDEO_MAX_ACTIVE = Number(process.env.VIDEO_MAX_ACTIVE ?? 1);

// Endpoints (separados si quieres)
const T2V_ENDPOINT =
  process.env.RP_WAN22_T2V_ENDPOINT ||
  process.env.VIDEO_RUNPOD_T2V_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_ENDPOINT ||
  null;

const I2V_ENDPOINT =
  process.env.IMG2VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_I2V_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_ENDPOINT_ID ||
  process.env.VIDEO_RUNPOD_ENDPOINT ||
  null;

function json(res, status, obj) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

async function runpodStatus({ endpointId, requestId }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing RunPod endpoint id");
  if (!requestId) throw new Error("Missing provider_request_id");

  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;
  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = data?.error || data?.message || JSON.stringify(data);
    throw new Error(`RunPod /status failed: ${r.status} ${msg}`);
  }
  return data;
}

async function runpodRun({ endpointId, input }) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / RP_API_KEY");
  if (!endpointId) throw new Error("Missing RunPod endpoint id");

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

function pickEndpointForJob(job) {
  // modo puede ser: "t2v" o "i2v"
  const mode = String(job?.mode || "").toLowerCase();
  if (mode === "i2v") return I2V_ENDPOINT;
  return T2V_ENDPOINT;
}

function normalizeRunpodStatus(rp) {
  // RunPod puede devolver { status: "COMPLETED"|"FAILED"|"IN_PROGRESS"|"IN_QUEUE" ... }
  // a veces lo trae en rp.status, a veces rp.output?.status no (depende)
  const s = String(rp?.status || rp?.state || "").toUpperCase();
  if (s) return s;
  return "UNKNOWN";
}

function extractProgress(rp) {
  // algunos workers mandan progress en output o en un campo custom
  // si no existe, devolvemos null
  const p =
    rp?.output?.progress ??
    rp?.progress ??
    rp?.output?.pct ??
    rp?.output?.percent ??
    null;

  if (p === null || p === undefined) return null;
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function extractDirectUrlFromOutput(output) {
  if (!output) return null;
  // soporta varias claves típicas
  return (
    output.video_url ||
    output.url ||
    output.directUrl ||
    output.direct_url ||
    output.result_url ||
    null
  );
}

function extractB64FromOutput(output) {
  if (!output) return null;
  return (
    output.video_b64 ||
    output.b64 ||
    output.base64 ||
    output.result_b64 ||
    null
  );
}

// Si tu worker ya sube a storage / devuelve url, aquí no necesitas subir nada.
// Si tu worker devuelve b64 y tú lo subes desde aquí, agrega tu uploader.
// Para que sea “plug & play”, este script solo acepta url o b64 y guarda.
// (Si b64, guarda en DB y el front lo renderiza como data:video/mp4;base64,... o lo subes luego)
function asDataVideoUrl(b64) {
  if (!b64) return null;
  const clean = String(b64).startsWith("data:") ? String(b64) : `data:video/mp4;base64,${b64}`;
  return clean;
}

async function markFailed(admin, jobId, msg) {
  await admin
    .from("video_jobs")
    .update({
      status: "FAILED",
      provider_status: String(msg || "FAILED").slice(0, 240),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  // ✅ libera slot SIEMPRE
  await admin.rpc("release_video_slot", { p_job_id: jobId });
}

async function markDoneWithUrl(admin, jobId, url) {
  await admin
    .from("video_jobs")
    .update({
      status: "DONE",
      provider_status: "COMPLETED",
      video_url: String(url),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  // ✅ libera slot SIEMPRE
  await admin.rpc("release_video_slot", { p_job_id: jobId });
}

async function markDoneWithB64(admin, jobId, b64) {
  // Puedes guardar b64 en otra columna si la tienes.
  // Aquí lo ponemos en video_url como data url para que el front lo muestre.
  const dataUrl = asDataVideoUrl(b64);

  await admin
    .from("video_jobs")
    .update({
      status: "DONE",
      provider_status: "COMPLETED",
      video_url: dataUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  // ✅ libera slot SIEMPRE
  await admin.rpc("release_video_slot", { p_job_id: jobId });
}

async function tryDispatchIfQueued(admin, job) {
  const jobId = job.id;

  // 1) reservar slot
  const { data: canDispatch, error: lockErr } = await admin.rpc("reserve_video_slot", {
    p_job_id: jobId,
    p_max_active: VIDEO_MAX_ACTIVE,
  });

  if (lockErr || !canDispatch) {
    return { dispatched: false, reason: lockErr?.message || "no_slot" };
  }

  // 2) despachar a RunPod
  const endpointId = pickEndpointForJob(job);
  const payload = (() => {
    // reusa lo que guardaste al crear el job
    // preferimos columnas directas
    const mode = String(job.mode || "t2v");
    const inp = {
      mode,
      job_id: jobId,
      user_id: job.user_id,
      prompt: job.prompt,
      negative_prompt: job.negative_prompt || "",
      width: job.width,
      height: job.height,
      fps: job.fps,
      num_frames: job.num_frames,
      steps: job.steps,
      guidance_scale: job.guidance_scale,
    };

    // si en payload guardaste aspect_ratio / duration_s / image_b64 / image_url, lo reinyectamos
    try {
      const raw = job.payload ? JSON.parse(job.payload) : null;
      if (raw?.aspect_ratio) inp.aspect_ratio = String(raw.aspect_ratio);
      if (raw?.duration_s) inp.duration_s = Number(raw.duration_s);
      if (raw?.seconds) inp.duration_s = Number(raw.seconds);
      if (raw?.image_b64) inp.image_b64 = String(raw.image_b64);
      if (raw?.image_url) inp.image_url = String(raw.image_url);
    } catch {}

    return inp;
  })();

  try {
    const rp = await runpodRun({ endpointId, input: payload });
    const runpodId = rp?.id || rp?.jobId || rp?.request_id || null;

    await admin
      .from("video_jobs")
      .update({
        status: "IN_PROGRESS",
        provider_status: "submitted",
        provider_request_id: runpodId ? String(runpodId) : null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return { dispatched: true, provider_request_id: runpodId };
  } catch (e) {
    // si falla dispatch, devolver a QUEUED y liberar slot
    await admin
      .from("video_jobs")
      .update({
        status: "QUEUED",
        provider_status: `dispatch_failed: ${String(e?.message || e).slice(0, 180)}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await admin.rpc("release_video_slot", { p_job_id: jobId });

    return { dispatched: false, reason: "dispatch_failed" };
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "Method not allowed" });

    const userId = await getUserIdFromAuthHeader(req);
    if (!userId) return json(res, 401, { ok: false, error: "Unauthorized" });

    const url = new URL(req.url, `https://${req.headers.host}`);
    const jobId = url.searchParams.get("job_id");
    if (!jobId) return json(res, 400, { ok: false, error: "Missing job_id" });

    // 1) leer job y validar ownership (o admin)
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("video_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobErr || !job) return json(res, 404, { ok: false, error: "Job not found" });
    if (String(job.user_id) !== String(userId)) return json(res, 403, { ok: false, error: "Forbidden" });

    const status = String(job.status || "QUEUED").toUpperCase();

    // 2) Si está DONE o FAILED, asegurar slot liberado y responder
    if (status === "DONE") {
      // (por si acaso quedó pegado)
      await supabaseAdmin.rpc("release_video_slot", { p_job_id: jobId });
      return json(res, 200, { ok: true, status: "DONE", video_url: job.video_url || null });
    }

    if (status === "FAILED") {
      await supabaseAdmin.rpc("release_video_slot", { p_job_id: jobId });
      return json(res, 200, { ok: true, status: "FAILED", error: job.provider_status || "FAILED" });
    }

    // 3) Si está IN_PROGRESS pero no tiene provider_request_id => stale → devolver a QUEUED + liberar
    if (status === "IN_PROGRESS" && !job.provider_request_id) {
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "QUEUED",
          provider_status: "stale_no_provider_request_id",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      await supabaseAdmin.rpc("release_video_slot", { p_job_id: jobId });

      return json(res, 200, { ok: true, status: "QUEUED", progress: 0, note: "stale reset" });
    }

    // 4) Si está QUEUED → intentar dispatch
    if (status === "QUEUED") {
      const d = await tryDispatchIfQueued(supabaseAdmin, job);

      // vuelve a leer para devolver estado actualizado si despachó
      const { data: job2 } = await supabaseAdmin.from("video_jobs").select("*").eq("id", jobId).single();

      if (d.dispatched) {
        return json(res, 200, {
          ok: true,
          status: "IN_PROGRESS",
          progress: 3,
          provider_request_id: job2?.provider_request_id || null,
        });
      }

      return json(res, 200, { ok: true, status: "QUEUED", progress: 0, reason: d.reason || "queued" });
    }

    // 5) IN_PROGRESS → consultar RunPod
    if (status === "IN_PROGRESS") {
      const endpointId = pickEndpointForJob(job);
      const requestId = String(job.provider_request_id || "");

      let rp;
      try {
        rp = await runpodStatus({ endpointId, requestId });
      } catch (e) {
        // si la consulta falla, NO matamos el job; devolvemos estado actual
        return json(res, 200, {
          ok: true,
          status: "IN_PROGRESS",
          progress: 5,
          note: `status_poll_failed: ${String(e?.message || e).slice(0, 180)}`,
        });
      }

      const rpStatus = normalizeRunpodStatus(rp);
      const progress = extractProgress(rp);

      if (rpStatus === "COMPLETED") {
        const out = rp?.output || null;
        const directUrl = extractDirectUrlFromOutput(out);
        const b64 = extractB64FromOutput(out);

        if (directUrl) {
          await markDoneWithUrl(supabaseAdmin, jobId, directUrl);
          return json(res, 200, { ok: true, status: "DONE", video_url: directUrl });
        }

        if (b64) {
          await markDoneWithB64(supabaseAdmin, jobId, b64);
          return json(res, 200, { ok: true, status: "DONE", video_url: asDataVideoUrl(b64) });
        }

        // completed pero sin output usable
        await markFailed(supabaseAdmin, jobId, "COMPLETED but missing output url/b64");
        return json(res, 200, { ok: true, status: "FAILED", error: "COMPLETED but missing output" });
      }

      if (rpStatus === "FAILED") {
        const errMsg =
          rp?.error ||
          rp?.output?.error ||
          rp?.output?.trace ||
          rp?.output?.message ||
          "RunPod FAILED";

        await markFailed(supabaseAdmin, jobId, String(errMsg).slice(0, 240));
        return json(res, 200, { ok: true, status: "FAILED", error: String(errMsg).slice(0, 240) });
      }

      // sigue corriendo / en cola en RunPod
      return json(res, 200, {
        ok: true,
        status: "IN_PROGRESS",
        progress: progress ?? 10,
        provider_status: rpStatus,
      });
    }

    // fallback
    return json(res, 200, { ok: true, status, progress: 0 });
  } catch (e) {
    return json(res, 500, { ok: false, error: e?.message || "Server error" });
  }
}
