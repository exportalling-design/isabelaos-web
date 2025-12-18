// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// MODO B (TU CASO): "TERMINATE y crear pod nuevo por job"
//
// Flujo:
// 1) Lock en Supabase para evitar 2 requests simultáneos.
// 2) Crea un Pod NUEVO usando templateId (RunPod REST).
// 3) Espera a RUNNING.
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
const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

// ✅ Template del pod de VIDEO (OBLIGATORIO en modo B)
const VIDEO_RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID;

// ✅ Network Volume (opcional, pero en tu caso lo quieres SIEMPRE)
const VIDEO_NETWORK_VOLUME_ID = process.env.VIDEO_NETWORK_VOLUME_ID || null;
const VIDEO_VOLUME_MOUNT_PATH = process.env.VIDEO_VOLUME_MOUNT_PATH || "/workspace";

// ✅ Si quieres terminar el pod automáticamente al terminar el job
const TERMINATE_AFTER_JOB = (process.env.TERMINATE_AFTER_JOB || "0") === "1";

// Tablas en Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000; // 12 min (cold start + descarga + boot)
const POLL_MS = 3000;

// =====================
// Helpers
// =====================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (backend only)");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setPodState(sb, patch) {
  // Requiere row id=1 en pod_state
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY in Vercel");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Espera que el worker responda
async function waitForWorkerReady(workerBase, maxMs = 8 * 60 * 1000) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  const candidates = [`${base}/health`, `${base}/api/video`];

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "GET" });

        // 200 OK => listo
        if (r.ok) return true;

        // 405 => existe ruta pero requiere POST (esto nos sirve para confirmar que el server está vivo)
        if (r.status === 405) return true;

        // 401/403 => también confirma server arriba
        if (r.status === 401 || r.status === 403) return true;
      } catch (e) {}
    }
    await sleep(2500);
  }
  throw new Error("Worker not ready: no respondió a /health o /api/video a tiempo (puerto 8000).");
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

// =====================
// RunPod: crear pod (modo B)
// =====================
async function runpodCreatePodFromTemplate() {
  if (!VIDEO_RUNPOD_TEMPLATE_ID) {
    throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID en Vercel (templateId del pod de video)");
  }

  // NOTA: RunPod REST: POST https://rest.runpod.io/v1/pods (soporta templateId). :contentReference[oaicite:1]{index=1}
  // En modo template, RunPod aplica la configuración del template automáticamente.
  // Si tu template ya define puertos y start command, perfecto.

  const body = {
    name: `isabela-video-${Date.now()}`,
    templateId: VIDEO_RUNPOD_TEMPLATE_ID,

    // Si quieres forzar el volumen en cada pod:
    ...(VIDEO_NETWORK_VOLUME_ID
      ? {
          networkVolumeId: VIDEO_NETWORK_VOLUME_ID,
          volumeMountPath: VIDEO_VOLUME_MOUNT_PATH,
        }
      : {}),
  };

  const r = await fetch("https://rest.runpod.io/v1/pods", {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`RunPod create pod failed (${r.status}): ${JSON.stringify(data)}`);
  }

  // data.id es el podId
  if (!data?.id) throw new Error("RunPod create pod: no devolvió id");
  return data;
}

async function runpodGetPod(podId) {
  const r = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, { headers: runpodHeaders() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`RunPod GET pod failed (${r.status}): ${JSON.stringify(data)}`);
  return data;
}

async function runpodWaitUntilRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = String(pod?.status || "").toUpperCase();
    if (status === "RUNNING") return pod;
    await sleep(POLL_MS);
  }
  throw new Error("Timeout: el pod no llegó a RUNNING a tiempo");
}

async function runpodTerminatePod(podId) {
  // DELETE /v1/pods/{id} (termina)
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

// Construye el proxy URL estándar de RunPod para el puerto 8000
function buildProxyUrl(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// =====================
// Main: crea pod y asegura worker arriba
// =====================
async function ensureFreshPod(sb) {
  // 1) Lock global
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensureFreshPod(sb);
  }

  await setPodState(sb, { status: "CREATING", last_used_at: new Date().toISOString() });

  // 2) Crear pod nuevo desde template
  const created = await runpodCreatePodFromTemplate();
  const podId = created.id;

  await setPodState(sb, {
    status: "STARTING",
    pod_id: podId,
    worker_url: null,
    last_used_at: new Date().toISOString(),
  });

  // 3) Esperar RUNNING
  await runpodWaitUntilRunning(podId);

  // 4) Construir endpoint público del worker
  const workerUrl = buildProxyUrl(podId);

  await setPodState(sb, {
    status: "RUNNING",
    pod_id: podId,
    worker_url: workerUrl,
    last_used_at: new Date().toISOString(),
  });

  // 5) Esperar que el worker responda
  await waitForWorkerReady(workerUrl);

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
    sb = sbAdmin();

    // 1) Crea pod nuevo + worker ready
    const fresh = await ensureFreshPod(sb);
    podId = fresh.podId;

    // 2) Proxy a /api/video del worker
    const url = `${fresh.workerUrl}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    await setPodState(sb, { last_used_at: new Date().toISOString() });

    // 3) (Opcional) Terminar pod al final
    if (TERMINATE_AFTER_JOB && podId) {
      await setPodState(sb, { status: "TERMINATING" });
      await runpodTerminatePod(podId);
      await setPodState(sb, { status: "TERMINATED", worker_url: null });
    }

    return res.status(r.status).json(data);
  } catch (e) {
    const msg = String(e?.message || e);

    // Intentar limpiar estado si alcanzamos a crear pod
    try {
      if (sb) await setPodState(sb, { status: "ERROR", last_error: msg, last_used_at: new Date().toISOString() });
    } catch {}

    // Si quieres ser agresivo y terminar pod también en error:
    try {
      if (TERMINATE_AFTER_JOB && podId) await runpodTerminatePod(podId);
    } catch {}

    return res.status(500).json({ ok: false, error: msg });
  }
}
