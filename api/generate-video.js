// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// Qué hace este endpoint:
// 1) Usa un LOCK en Supabase para evitar 2 requests simultáneos usando el pod.
// 2) Valida el endpoint público del worker (VIDEO_RP_ENDPOINT).
// 3) (Opcional) Si hay POD_ID + API_KEY, intenta START/RESUME el mismo pod.
// 4) Espera que el worker responda (/health o /api/video).
// 5) Proxy: reenvía el payload al worker (/api/video) y devuelve su respuesta.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
// ✅ Admin (solo backend): para escribir/leer tablas de lock/state en Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ✅ VIDEO aislado (NO pisar RP_ENDPOINT de imágenes)
const RP_ENDPOINT = process.env.VIDEO_RP_ENDPOINT; // ej: https://xxxx-8000.proxy.runpod.net

// ✅ Opcional: solo si vas a REUSAR el MISMO pod (stop/resume). Si tú "TERMINATE" y creas otro nuevo, esto cambia.
const RUNPOD_POD_ID = process.env.VIDEO_RUNPOD_POD_ID || null;

// ✅ API Key: si definiste VIDEO_RUNPOD_API_KEY úsala; si no, cae a RUNPOD_API_KEY global si existe.
const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

// Tablas en Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;            // lock para evitar colisiones
const READY_TIMEOUT_MS = 10 * 60 * 1000; // 10 min esperando pod RUNNING
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
  // Requiere que exista row id=1 en pod_state
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// Espera que el worker responda en el endpoint público
async function waitForWorkerReady(workerBase, maxMs = 5 * 60 * 1000) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  // Candidatos: /health ideal, /api/video puede devolver 405 en GET y eso vale.
  const candidates = [
    `${base}/health`,
    `${base}/api/video`,
  ];

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "GET" });

        // OK => listo
        if (r.ok) return true;

        // 405 (Method Not Allowed) => significa que existe la ruta y el server está vivo
        if (r.status === 405) return true;

        // 401/403 también sirve como “está arriba” (si luego proteges)
        if (r.status === 401 || r.status === 403) return true;
      } catch (e) {
        // ignorar y seguir intentando
      }
    }
    await sleep(2500);
  }

  throw new Error("Worker not ready: no respondió a /health o /api/video a tiempo. Revisa VIDEO_RP_ENDPOINT (puerto 8000).");
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
// RunPod REST helpers (solo si REUSAS el mismo pod)
// =====================
function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY in Vercel");
  return { Authorization: `Bearer ${RUNPOD_API_KEY}` };
}

async function runpodGetPod(podId) {
  const url = `https://rest.runpod.io/v1/pods/${podId}`;
  const r = await fetch(url, { headers: runpodHeaders() });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod GET pod failed (${r.status}): ${t}`);
  }
  return await r.json();
}

async function runpodStartOrResumePod(podId) {
  // Algunos pods usan /start, otros /resume según estado/config
  const candidates = [
    `https://rest.runpod.io/v1/pods/${podId}/start`,
    `https://rest.runpod.io/v1/pods/${podId}/resume`,
  ];

  let lastErr = null;
  for (const url of candidates) {
    const r = await fetch(url, { method: "POST", headers: runpodHeaders() });
    if (r.ok) return true;

    const t = await r.text().catch(() => "");
    lastErr = new Error(`RunPod start/resume failed (${r.status}) at ${url}: ${t}`);
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
  throw new Error("Timeout: el pod no llegó a RUNNING dentro del tiempo configurado");
}

// =====================
// Main: asegura worker arriba
// =====================
async function ensurePodRunning(sb) {
  // 1) Lock global
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  // 2) Debe existir endpoint público
  if (!RP_ENDPOINT) {
    await setPodState(sb, { status: "ERROR" });
    throw new Error("Falta VIDEO_RP_ENDPOINT en Vercel (URL pública del worker en puerto 8000)");
  }

  // 3) Guarda info en pod_state (audit / debug)
  await setPodState(sb, {
    worker_url: RP_ENDPOINT,
    pod_id: RUNPOD_POD_ID,
    last_used_at: new Date().toISOString(),
  });

  // 4) Si tenemos POD_ID + API_KEY => intentamos arrancar/reanudar ese MISMO pod
  //    Si NO tenemos, asumimos que el pod ya está RUNNING y solo probamos worker.
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
    // Sin POD_ID/API => no podemos arrancar nada desde Vercel, solo verificar que está vivo
    await setPodState(sb, { status: "RUNNING" });
  }

  // 5) Esperar que el worker responda
  await waitForWorkerReady(RP_ENDPOINT, 5 * 60 * 1000);

  return RP_ENDPOINT;
}

// =====================
// API route
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const sb = sbAdmin();

    // 1) pod/worker ready
    const workerBase = await ensurePodRunning(sb);

    // 2) proxy a /api/video del worker
    const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;
    const url = `${base}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    // 3) update last_used_at
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
