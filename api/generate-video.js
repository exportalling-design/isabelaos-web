// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// OBJETIVO REAL (tu caso):
// - El pod NO es fijo. Se TERMINA y se crea otro.
// - Por eso NO podemos guardar VIDEO_RP_ENDPOINT fijo en Vercel.
// - En su lugar: creamos/obtenemos POD_ID y derivamos el endpoint:
//
//    RP_ENDPOINT = `https://${POD_ID}-8000.proxy.runpod.net`
//
// Flujo:
// 1) Lock en Supabase (evitar 2 pods creados a la vez).
// 2) Si no hay pod activo (o murió), CREAR POD por API (desde template).
// 3) Derivar endpoint del POD_ID.
// 4) Esperar worker listo (/health o /api/video con 405).
// 5) Proxy POST -> {endpoint}/api/video
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
// ✅ Admin (solo backend): para escribir/leer tablas de lock/state en Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ✅ RunPod API Key (backend only)
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY ||
  process.env.RUNPOD_API_KEY ||
  process.env.RP_API_KEY ||
  null;

// ✅ (Tu caso) Creación dinámica desde Template
// Debes poner esto en Vercel:
const VIDEO_TEMPLATE_ID = process.env.VIDEO_TEMPLATE_ID || null;

// Opcional: fuerza GPU (para evitar A6000). Depende de cómo creas pod.
// Si tu template ya fuerza A100-SXM, no necesitas esto.
const VIDEO_GPU_ID = process.env.VIDEO_GPU_ID || null;

// Tablas en Supabase
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Timing
const LOCK_SECONDS = 180;                 // lock para evitar colisiones
const READY_TIMEOUT_MS = 10 * 60 * 1000;  // 10 min esperando ready
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

async function getPodState(sb) {
  const { data, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

// Deriva endpoint dinámico desde pod_id (clave para tu caso TERMINATE)
function deriveRpEndpointFromPodId(podId) {
  if (!podId) return null;
  return `https://${podId}-8000.proxy.runpod.net`;
}

// Espera que el worker responda en el endpoint público
async function waitForWorkerReady(workerBase, maxMs = 5 * 60 * 1000) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  // /health ideal, /api/video puede devolver 405 (Method Not Allowed) y eso ES OK
  const candidates = [`${base}/health`, `${base}/api/video`];

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "GET" });

        if (r.ok) return true;
        if (r.status === 405) return true;
        if (r.status === 401 || r.status === 403) return true;
      } catch (e) {}
    }
    await sleep(2500);
  }

  throw new Error(
    "Worker not ready: no respondió a /health o /api/video. " +
    "Revisa: que el pod abra el puerto 8000 y que tu server arranque en 0.0.0.0:8000."
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
// RunPod API helpers
// =====================
function runpodHeaders() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY in Vercel");
  return {
    Authorization: `Bearer ${RUNPOD_API_KEY}`,
    "Content-Type": "application/json",
  };
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

async function waitUntilRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status = (pod?.status || "").toUpperCase();
    if (status === "RUNNING") return pod;
    await sleep(POLL_MS);
  }
  throw new Error("Timeout: el pod no llegó a RUNNING a tiempo");
}

/**
 * Crea un POD NUEVO desde TEMPLATE (tu arquitectura TERMINATE).
 *
 * NOTA:
 * - Hay varias formas (REST o GraphQL).
 * - Tú preguntaste “GraphQL create pod”: perfecto, lo pones aquí.
 *
 * Si ya tienes tu mutation lista, pégala aquí y listo.
 * Este stub devuelve { id } que luego usamos para derivar el endpoint.
 */
async function runpodCreatePodFromTemplate() {
  if (!VIDEO_TEMPLATE_ID) throw new Error("Missing VIDEO_TEMPLATE_ID in Vercel");

  // =========================================================
  // OPCIÓN 1 (si usas GraphQL):
  // POST https://api.runpod.io/graphql
  //
  // const query = `mutation ($input: Pod...){ ... }`
  // const variables = { input: { templateId: VIDEO_TEMPLATE_ID, gpuId: VIDEO_GPU_ID, ... } }
  // =========================================================
  //
  // IMPORTANTE: como el schema exacto varía, aquí lo dejo como “bloque adaptable”.
  // Si me pegas tu mutation real (la que estabas usando), te lo dejo 100% exacto.
  //
  // Ejemplo de estructura:
  //
  // const gqlRes = await fetch("https://api.runpod.io/graphql", {
  //   method: "POST",
  //   headers: runpodHeaders(),
  //   body: JSON.stringify({ query, variables }),
  // });
  // const out = await gqlRes.json();
  // const podId = out?.data?.createPod?.id;  // <- AJUSTAR A TU RESPUESTA
  // if (!podId) throw new Error("Create pod failed: no id returned");
  // return { id: podId };

  // =========================================================
  // OPCIÓN 2 (si tu setup usa REST “deploy from template”):
  // Si tú ya tienes el endpoint REST exacto, lo pones aquí.
  // =========================================================

  throw new Error(
    "CreatePod not implemented: pega aquí tu mutation GraphQL (create pod from template) " +
    "para que devuelva el podId. Este paso es el que te falta para que NO dependas de VIDEO_RP_ENDPOINT."
  );
}

// =====================
// Main: asegura worker arriba (pod dinámico)
// =====================
async function ensurePodRunning(sb) {
  // 1) Lock global
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensurePodRunning(sb);
  }

  // 2) Lee estado actual
  let state = await getPodState(sb);
  let podId = state?.pod_id || null;

  // 3) Si existe pod_id, verificamos si sigue vivo
  //    Si no existe o ya murió, creamos uno nuevo.
  let needNewPod = false;

  if (!podId) {
    needNewPod = true;
  } else {
    try {
      const pod = await runpodGetPod(podId);
      const status = (pod?.status || "").toUpperCase();
      if (!status || status === "TERMINATED" || status === "STOPPED") needNewPod = true;
    } catch (e) {
      // si GET falla, asumimos que ya no existe
      needNewPod = true;
    }
  }

  if (needNewPod) {
    await setPodState(sb, { status: "CREATING", last_used_at: new Date().toISOString() });

    const created = await runpodCreatePodFromTemplate(); // <<< AQUÍ va tu GraphQL real
    podId = created?.id;

    if (!podId) throw new Error("Create pod failed: no podId");

    // Guarda pod_id en Supabase
    await setPodState(sb, {
      pod_id: podId,
      status: "STARTING",
      last_used_at: new Date().toISOString(),
    });
  }

  // 4) Espera RUNNING
  await waitUntilRunning(podId);

  // 5) Deriva endpoint dinámico por podId (clave)
  const rpEndpoint = deriveRpEndpointFromPodId(podId);

  await setPodState(sb, {
    worker_url: rpEndpoint,
    status: "RUNNING",
    last_used_at: new Date().toISOString(),
  });

  // 6) Espera que el worker responda
  await waitForWorkerReady(rpEndpoint, 5 * 60 * 1000);

  return rpEndpoint;
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

    const workerBase = await ensurePodRunning(sb);
    const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;
    const url = `${base}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    await setPodState(sb, { last_used_at: new Date().toISOString() });

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
