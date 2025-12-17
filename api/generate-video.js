// /api/generate-video.js
import { createClient } from "@supabase/supabase-js";

// =====================
// ENV
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Para validar el JWT del usuario (NO service role)
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Worker URL pública del pod (puerto del worker, ej :8000)
const RP_ENDPOINT = process.env.RP_ENDPOINT;

// Pod control (opcional si quieres start/stop)
const RUNPOD_POD_ID = process.env.RUNPOD_POD_ID || null;
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || null;

// Storage bucket
const VIDEO_BUCKET = process.env.VIDEO_BUCKET || "videos";

// Supabase tables
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";
const VIDEO_JOBS_TABLE = "video_jobs";

// Lock settings
const LOCK_SECONDS = 90;

// Start polling settings
const READY_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 3000;

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function sbPublic() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) throw new Error("Missing SUPABASE_ANON_KEY (o VITE_SUPABASE_ANON_KEY)");
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// ============================================================
// Worker readiness
// ============================================================
async function waitForWorkerReady(workerBase, maxMs = 5 * 60 * 1000) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  const candidates = [`${base}/health`, `${base}/api/health`, `${base}/api/video`];

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "GET" });
        if (r.ok) return true;
        if (r.status === 405) return true;
        if (r.status === 401 || r.status === 403) return true;
      } catch {}
    }
    await sleep(2500);
  }
  throw new Error("Worker not ready: no respondió a tiempo");
}

// ============================================================
// Supabase lock
// ============================================================
async function acquireLock(sb) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  const { data: row, error: readErr } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("id", 1)
    .single();

  if (readErr) throw new Error("No existe pod_lock id=1 (crea row en Supabase)");

  const current = row.locked_until ? new Date(row.locked_until) : null;
  if (current && current > now) return { ok: false, locked_until: row.locked_until };

  const { error: updErr } = await sb.from(POD_LOCK_TABLE).update({ locked_until: lockedUntil }).eq("id", 1);
  if (updErr) return { ok: false, locked_until: row.locked_until };

  return { ok: true, locked_until: lockedUntil };
}

async function waitForUnlock(sb) {
  while (true) {
    const { data, error } = await sb.from(POD_LOCK_TABLE).select("*").eq("id", 1).single();
    if (error) throw error;

    const until = data.locked_until ? new Date(data.locked_until) : null;
    const now = new Date();

    if (!until || until <= now) return true;
    await sleep(1500);
  }
}

// ============================================================
// RunPod REST helpers (opcional)
// ============================================================
function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}` };
}

async function runpodGetPod(podId) {
  const url = `https://rest.runpod.io/v1/pods/${podId}`;
  const r = await fetch(url, { headers: runpodHeaders() });
  if (!r.ok) throw new Error(`RunPod GET pod failed (${r.status}): ${await r.text().catch(() => "")}`);
  return await r.json();
}

async function runpodStartOrResumePod(podId) {
  const candidates = [
    `https://rest.runpod.io/v1/pods/${podId}/start`,
    `https://rest.runpod.io/v1/pods/${podId}/resume`,
  ];
  let lastErr = null;

  for (const url of candidates) {
    const r = await fetch(url, { method: "POST", headers: runpodHeaders() });
    if (r.ok) return true;
    lastErr = new Error(`RunPod start/resume failed (${r.status}) at ${url}: ${await r.text().catch(() => "")}`);
  }
  throw lastErr || new Error("RunPod start/resume failed");
}

async function waitUntilRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = (pod?.status || "").toUpperCase();
    if (status === "RUNNING") return pod;
    await sleep(POLL_MS);
  }
  throw new Error("Timeout: el pod no llegó a RUNNING");
}

async function ensurePodRunning(sb) {
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  if (!RP_ENDPOINT) {
    await setPodState(sb, { status: "ERROR" });
    throw new Error("Falta RP_ENDPOINT (URL pública del worker)");
  }

  await setPodState(sb, {
    worker_url: RP_ENDPOINT,
    pod_id: RUNPOD_POD_ID,
    last_used_at: new Date().toISOString(),
  });

  if (RUNPOD_POD_ID && RUNPOD_API_KEY) {
    const pod = await runpodGetPod(RUNPOD_POD_ID);
    const status = (pod?.status || "").toUpperCase();

    if (status !== "RUNNING") {
      await setPodState(sb, { status: "STARTING" });
      await runpodStartOrResumePod(RUNPOD_POD_ID);
      await waitUntilRunning(RUNPOD_POD_ID);
      await setPodState(sb, { status: "RUNNING", last_used_at: new Date().toISOString() });
    } else {
      await setPodState(sb, { status: "RUNNING" });
    }
  } else {
    await setPodState(sb, { status: "RUNNING" });
  }

  await waitForWorkerReady(RP_ENDPOINT, 5 * 60 * 1000);
  return RP_ENDPOINT;
}

// ============================================================
// Auth: extrae usuario del JWT que manda el frontend
// ============================================================
async function requireUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new Error("Missing Authorization Bearer token");

  const sb = sbPublic();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid token");
  return data.user;
}

// ============================================================
// MAIN API ROUTE
// ============================================================
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const user = await requireUser(req);
    const sb = sbAdmin();

    // 1) Crea job en Supabase (QUEUED)
    const body = req.body || {};
    const mode = body.mode || "t2v"; // "t2v" o "i2v"

    const {
      prompt,
      negative_prompt,
      width = 1280,
      height = 704,
      num_frames = 121,
      fps = 24,
      steps = 50,
      guidance_scale = 5.0,
      // i2v: la imagen NO se sube al pod como archivo; la mandas como URL/base64 al worker
      // (lo veremos en el worker)
      input_image_url = null,
      input_image_base64 = null,
    } = body;

    // Path único por usuario/job
    const safeUser = user.id;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const storagePath = `${safeUser}/${ts}.mp4`;

    const { data: job, error: jobErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .insert({
        user_id: user.id,
        status: "QUEUED",
        mode,
        prompt: prompt || null,
        negative_prompt: negative_prompt || null,
        width,
        height,
        num_frames,
        fps,
        steps,
        guidance_scale,
        storage_bucket: VIDEO_BUCKET,
        storage_path: storagePath,
      })
      .select("*")
      .single();

    if (jobErr) throw jobErr;

    // 2) Asegura pod RUNNING + worker listo
    const workerBase = await ensurePodRunning(sb);

    // 3) Signed Upload URL para que el POD suba el MP4 directo a Supabase Storage
    // Nota: En supabase-js v2: createSignedUploadUrl(path)
    const { data: up, error: upErr } = await sb.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (upErr) throw upErr;

    // 4) Mandar job al worker (ASYNC)
    const workerUrl = (workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase) + "/api/video";

    const payload = {
      job_id: job.id,
      mode,

      prompt,
      negative_prompt,
      width,
      height,
      num_frames,
      fps,
      steps,
      guidance_scale,

      // i2v inputs (uno u otro)
      input_image_url,
      input_image_base64,

      // Upload target (signed)
      upload: {
        bucket: VIDEO_BUCKET,
        path: storagePath,
        signed_upload_url: up.signedUrl,
        token: up.token, // algunos flows lo usan; pásalo por si tu worker lo necesita
        content_type: "video/mp4",
      },

      // Importante: el worker debe:
      // - generar el mp4 en /tmp o /workspace/tmp
      // - subirlo a signed_upload_url
      // - borrar el mp4 local
      async: true,
    };

    // Marcamos RUNNING temprano
    await sb.from(VIDEO_JOBS_TABLE).update({ status: "RUNNING", updated_at: new Date().toISOString() }).eq("id", job.id);

    // Dispara sin bloquear demasiado (igual hacemos fetch; el worker debe responder rápido)
    const r = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const resp = await r.json().catch(() => ({}));
    if (!r.ok) {
      await sb
        .from(VIDEO_JOBS_TABLE)
        .update({ status: "ERROR", error: resp?.error || `Worker error ${r.status}`, updated_at: new Date().toISOString() })
        .eq("id", job.id);

      return res.status(500).json({ ok: false, job_id: job.id, error: resp?.error || "Worker error" });
    }

    // last_used_at para autosleep
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    // 5) Respuesta inmediata al frontend
    return res.status(200).json({ ok: true, job_id: job.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
