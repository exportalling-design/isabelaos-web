// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// MODO B (TU CASO): "TERMINATE y crear pod nuevo por job"
//
// Flujo:
// 1) Lock en Supabase para evitar 2 requests simultáneos.
// 2) Crea un Pod NUEVO usando templateId (RunPod REST).
// 3) Espera a RUNNING/READY.
// 4) Construye el endpoint público del pod: https://{podId}-8000.proxy.runpod.net
// 5) Espera que el worker responda (/health o /api/video).
// 6) Proxy: reenvía el payload al worker (/api/video).
// 7) (Opcional) Termina el pod al final si TERMINATE_AFTER_JOB=1.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
// ✅ Admin (solo backend)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ✅ RunPod
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

// ✅ Template del pod de VIDEO (OBLIGATORIO en modo B)
const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID;

// ✅ Network Volume (EN TU CASO: SIEMPRE)
const VIDEO_RUNPOD_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID ||
  process.env.VIDEO_NETWORK_VOLUME_ID ||
  null;

// En tu caso debe ser /workspace para que encuentre /workspace/start.sh
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

// ✅ Si quieres terminar el pod automáticamente al terminar el job
const TERMINATE_AFTER_JOB = (process.env.TERMINATE_AFTER_JOB || "0") === "1";

// ✅ (NUEVO) Limite de steps (solo clamp; NO toca frames)
// Puedes setearlo en Vercel: VIDEO_MAX_STEPS=25 (o 20, 30, etc.)
const VIDEO_MAX_STEPS = Number(process.env.VIDEO_MAX_STEPS || "25");

// Tablas en Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000; // 12 min (cold start + descarga + boot)
const POLL_MS = 3000;

// Worker checks / proxy
const WORKER_READY_TIMEOUT_MS = 8 * 60 * 1000;
const HEALTH_FETCH_TIMEOUT_MS = 8000;

// OJO: esto NO es el tiempo real de generación del video.
// Es solo el tiempo para que /api/video responda ALGO.
const VIDEO_FETCH_TIMEOUT_MS = 60 * 1000;

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (backend only)");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY)
    throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY in Vercel");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// =====================
// Worker readiness
// =====================
async function waitForWorkerReady(workerBase, maxMs = WORKER_READY_TIMEOUT_MS) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  const candidates = [`${base}/health`, `${base}/api/video`];
  let lastInfo = "no-attempt";

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetchWithTimeout(url, { method: "GET" }, HEALTH_FETCH_TIMEOUT_MS);
        const txt = await r.text().catch(() => "");

        console.log("[GV] waitWorker url=", url, "status=", r.status, "body=", txt.slice(0, 120));

        if (r.ok) return true;
        if (r.status === 405) return true; // Method Not Allowed pero endpoint existe
        if (r.status === 401 || r.status === 403) return true;

        lastInfo = `${url} -> ${r.status} ${txt.slice(0, 120)}`;
      } catch (e) {
        lastInfo = `${url} -> ERR ${String(e)}`;
        console.log("[GV] waitWorker error url=", url, "err=", String(e));
      }
    }
    await sleep(2500);
  }

  throw new Error(
    "Worker not ready: no respondió a /health o /api/video a tiempo (puerto 8000). Último: " +
      lastInfo
  );
}

// =====================
// Lock (Supabase)
// =====================
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

  const { error: updErr } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: lockedUntil })
    .eq("id", 1);

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

// =====================
// RunPod: crear pod (modo B)
// =====================
async function runpodCreatePodFromTemplate() {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) {
    throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID en Vercel (templateId del pod de video)");
  }

  if (!VIDEO_RUNPOD_NETWORK_VOLUME_ID) {
    throw new Error(
      "Falta VIDEO_RUNPOD_NETWORK_VOLUME_ID en Vercel. Este pod necesita el Network Volume para /workspace/start.sh"
    );
  }

  const body = {
    name: `isabela-video-${Date.now()}`,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,
    networkVolumeId: VIDEO_RUNPOD_NETWORK_VOLUME_ID,
    volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
  };

  const r = await fetch("https://rest.runpod.io/v1/pods", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`RunPod create pod failed (${r.status}): ${JSON.stringify(data)}`);

  if (!data?.id) throw new Error("RunPod create pod: no devolvió id");
  return data;
}

async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    headers: runpodHeaders(),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`RunPod GET pod failed (${r.status}): ${JSON.stringify(data)}`);

  // ✅ RunPod a veces devuelve { pod: {...} }
  return data?.pod || data;
}

function pickPodStatus(pod) {
  const raw =
    pod?.status ??
    pod?.state ??
    pod?.desiredStatus ??
    pod?.runtime?.status ??
    pod?.pod?.status ??
    "";

  return String(raw || "").toUpperCase();
}

async function runpodWaitUntilRunning(podId) {
  const start = Date.now();
  let lastSample = "";

  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = pickPodStatus(pod);

    if (!status) {
      const sample = {
        keys: Object.keys(pod || {}),
        status: pod?.status,
        state: pod?.state,
        desiredStatus: pod?.desiredStatus,
        runtime: pod?.runtime,
      };
      lastSample = JSON.stringify(sample).slice(0, 900);
      console.log("[GV] waitRunning status=EMPTY sample=", lastSample, "podId=", podId);
    } else {
      console.log("[GV] waitRunning status=", status, "podId=", podId);
    }

    if (status === "RUNNING" || status === "READY" || status === "ACTIVE") return pod;

    await sleep(POLL_MS);
  }

  throw new Error("Timeout: el pod no llegó a RUNNING/READY a tiempo. Last: " + lastSample);
}

async function runpodTerminatePod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
    method: "DELETE",
    headers: runpodHeaders(),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod terminate failed (${r.status}): ${t}`);
  }
  return true;
}

function buildProxyUrl(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// =====================
// Main: crea pod y asegura worker arriba
// =====================
async function ensureFreshPod(sb) {
  console.log("[GV] step=LOCK_BEGIN");
  const got = await acquireLock(sb);

  if (!got.ok) {
    console.log("[GV] step=LOCK_BUSY wait...");
    await waitForUnlock(sb);
    return await ensureFreshPod(sb);
  }

  console.log("[GV] step=LOCK_OK");
  await setPodState(sb, { status: "CREATING", last_used_at: new Date().toISOString() });

  console.log("[GV] step=CREATE_POD_REQUEST");
  const created = await runpodCreatePodFromTemplate();
  const podId = created.id;
  console.log("[GV] created podId=", podId);

  await setPodState(sb, {
    status: "STARTING",
    pod_id: podId,
    worker_url: null,
    last_used_at: new Date().toISOString(),
  });

  console.log("[GV] step=WAIT_RUNNING_BEGIN", { podId });
  await runpodWaitUntilRunning(podId);
  console.log("[GV] step=WAIT_RUNNING_OK", { podId });

  const workerUrl = buildProxyUrl(podId);
  console.log("[GV] workerBase=", workerUrl);

  await setPodState(sb, {
    status: "RUNNING",
    pod_id: podId,
    worker_url: workerUrl,
    last_used_at: new Date().toISOString(),
  });

  console.log("[GV] step=WAIT_WORKER_BEGIN");
  await waitForWorkerReady(workerUrl);
  console.log("[GV] step=WAIT_WORKER_OK");

  return { podId, workerUrl };
}

// =====================
// API route
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  let sb = null;
  let podId = null;

  try {
    console.log("[GV] step=START");
    sb = sbAdmin();

    // ✅ Normaliza body (a veces Vercel lo entrega como string)
    const payloadRaw =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    // ✅ (NUEVO) Clamp SOLO de steps (no toca frames)
    const rawSteps = Number(payloadRaw?.steps ?? payloadRaw?.num_inference_steps ?? 0);
    const stepsClamped =
      Number.isFinite(rawSteps) && rawSteps > 0
        ? Math.max(1, Math.min(rawSteps, VIDEO_MAX_STEPS))
        : VIDEO_MAX_STEPS;

    console.log("[GV] payload steps=", stepsClamped, "MAX_STEPS=", VIDEO_MAX_STEPS);

    // ✅ Inyecta user_id requerido por el worker (sin tocar lo demás)
    const payload = {
      user_id: payloadRaw.user_id || "web-user",
      ...payloadRaw,
      // fuerza steps hacia el worker (tu worker usa "steps")
      steps: stepsClamped,
    };

    // 1) Crea pod nuevo + worker ready
    const fresh = await ensureFreshPod(sb);
    podId = fresh.podId;

    // 2) Proxy a /api/video del worker
    const url = `${fresh.workerUrl}/api/video`;
    console.log("[GV] step=CALL_API_VIDEO_BEGIN url=", url);

    // Opcional: marca BUSY mientras genera
    await setPodState(sb, { status: "BUSY", last_used_at: new Date().toISOString() });

    const r = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      VIDEO_FETCH_TIMEOUT_MS
    );

    const ct = (r.headers.get("content-type") || "").toLowerCase();
    console.log("[GV] step=CALL_API_VIDEO_RESPONSE status=", r.status, "ct=", ct);

    await setPodState(sb, { last_used_at: new Date().toISOString(), status: "RUNNING" });

    // ✅ Si RunPod/Proxy devuelve HTML (ej: 524/502), NO lo tratamos como binario mp4
    if (ct.includes("text/html")) {
      const html = await r.text().catch(() => "");
      console.log("[GV] worker_html_error status=", r.status, "html=", html.slice(0, 400));

      if (TERMINATE_AFTER_JOB && podId) {
        console.log("[GV] step=TERMINATE_BEGIN");
        await setPodState(sb, { status: "TERMINATING" });
        await runpodTerminatePod(podId);
        await setPodState(sb, { status: "TERMINATED", worker_url: null, pod_id: null });
        console.log("[GV] step=TERMINATE_OK");
      }

      return res.status(502).json({
        ok: false,
        error: "RunPod proxy devolvió HTML (timeout/502/524). La generación tardó más de lo permitido.",
        status: r.status,
        podId,
      });
    }

    // ✅ JSON response + log error 4xx/5xx del worker
    if (ct.includes("application/json")) {
      const data = await r.json().catch(() => ({}));

      if (r.status >= 400) {
        console.log(
          "[GV] worker_error status=",
          r.status,
          "data=",
          JSON.stringify(data).slice(0, 2000)
        );
      }

      if (TERMINATE_AFTER_JOB && podId) {
        console.log("[GV] step=TERMINATE_BEGIN");
        await setPodState(sb, { status: "TERMINATING" });
        await runpodTerminatePod(podId);
        await setPodState(sb, { status: "TERMINATED", worker_url: null, pod_id: null });
        console.log("[GV] step=TERMINATE_OK");
      }

      console.log("[GV] step=DONE_JSON");
      return res.status(r.status).json(data);
    }

    // ✅ Binary response (mp4)
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);

    res.setHeader("Content-Type", ct || "application/octet-stream");
    res.setHeader("Content-Length", String(buf.length));

    if (TERMINATE_AFTER_JOB && podId) {
      console.log("[GV] step=TERMINATE_BEGIN");
      await setPodState(sb, { status: "TERMINATING" });
      await runpodTerminatePod(podId);
      await setPodState(sb, { status: "TERMINATED", worker_url: null, pod_id: null });
      console.log("[GV] step=TERMINATE_OK");
    }

    console.log("[GV] step=DONE_BINARY bytes=", buf.length);
    return res.status(r.status).send(buf);
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[GV] ERROR:", msg);

    try {
      if (sb) {
        await setPodState(sb, {
          status: "ERROR",
          last_error: msg,
          last_used_at: new Date().toISOString(),
        });
      }
    } catch {}

    try {
      if (considerTerminateOnError() && podId) {
        console.log("[GV] step=TERMINATE_ON_ERROR_BEGIN");
        await runpodTerminatePod(podId);
        console.log("[GV] step=TERMINATE_ON_ERROR_OK");
      }
    } catch (err) {
      console.error("[GV] terminate on error failed:", String(err));
    }

    return res.status(500).json({ ok: false, error: msg, podId });
  }
}

function considerTerminateOnError() {
  return TERMINATE_AFTER_JOB;
}
