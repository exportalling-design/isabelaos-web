// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless Function)
//
// ✅ MODO CORRECTO PARA TU CASO (pods efímeros con TERMINATE):
// - NO hay RP_ENDPOINT fijo porque cada pod nuevo tiene URL nueva.
// - Este endpoint CREA un pod por API (RunPod GraphQL) usando TEMPLATE_ID,
//   espera a RUNNING, obtiene el proxy URL del puerto 8000,
//   valida /health o /api/video, y luego hace proxy a /api/video.
// - (Opcional) al final termina el pod.
//
// IMPORTANTE:
// - Esto NO depende de VIDEO_RP_ENDPOINT.
// - Esto sirve aunque cada request cree un pod nuevo.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================

// Supabase admin (backend only)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod API key (acepta cualquiera de estas)
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || process.env.RP_API_KEY || null;

// Template ID de RunPod (EL QUE CREASTE PARA VIDEO)
const RUNPOD_TEMPLATE_ID =
  process.env.VIDEO_RUNPOD_TEMPLATE_ID ||
  process.env.RUNPOD_TEMPLATE_ID ||
  null;

// Puerto del worker dentro del pod (tu worker está en 8000)
const VIDEO_PORT = Number(process.env.VIDEO_PORT || 8000);

// Tablas en Supabase (si las estás usando)
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Lock / timeouts
const LOCK_SECONDS = 180;
const READY_TIMEOUT_MS = 12 * 60 * 1000; // 12 min cold start worst-case
const POLL_MS = 3000;

// Si quieres terminar el pod cuando termina el request:
const TERMINATE_AFTER_REQUEST = true;

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
  // Requiere row id=1
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// =====================
// Lock (Supabase) opcional
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

    await sleep(1200);
  }
}

// =====================
// RunPod GraphQL
// =====================
function assertRunpodEnv() {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY (o RP_API_KEY) in Vercel");
  if (!RUNPOD_TEMPLATE_ID) throw new Error("Missing RUNPOD_TEMPLATE_ID in Vercel (template de VIDEO)");
}

async function runpodGraphQL(query, variables) {
  assertRunpodEnv();

  const r = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(`RunPod GraphQL HTTP ${r.status}: ${JSON.stringify(json)}`);
  }
  if (json.errors?.length) {
    throw new Error(`RunPod GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// 1) Crear pod desde template
async function createPodFromTemplate() {
  const mutation = `
    mutation CreatePod($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
        name
      }
    }
  `;

  // El input exacto depende de tu template.
  // Lo mínimo: templateId.
  // Si tu cuenta requiere algo más, lo ajustamos con el error real.
  const variables = {
    input: {
      templateId: RUNPOD_TEMPLATE_ID,
      // name opcional
      name: `isabela-video-${Date.now()}`,
    },
  };

  const data = await runpodGraphQL(mutation, variables);
  const pod = data?.podFindAndDeployOnDemand;
  if (!pod?.id) throw new Error("CreatePod: no devolvió pod id");
  return pod.id;
}

// 2) Leer estado y puertos del pod
async function getPod(podId) {
  const query = `
    query Pod($id: String!) {
      pod(id: $id) {
        id
        desiredStatus
        status
        runtime {
          ports {
            ip
            isPublic
            privatePort
            publicPort
            type
          }
        }
      }
    }
  `;
  const data = await runpodGraphQL(query, { id: podId });
  return data?.pod;
}

// 3) Esperar a RUNNING
async function waitUntilRunning(podId) {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const pod = await getPod(podId);
    const status = String(pod?.status || "").toUpperCase();
    if (status === "RUNNING") return pod;
    await sleep(POLL_MS);
  }
  throw new Error("Timeout: el pod no llegó a RUNNING");
}

// 4) Construir proxy URL del puerto 8000
function buildProxyUrlFromPod(pod) {
  // En algunos pods, ports trae publicPort que corresponde al proxy.
  // Buscamos el puerto cuyo privatePort sea 8000.
  const ports = pod?.runtime?.ports || [];
  const match = ports.find((p) => Number(p.privatePort) === VIDEO_PORT);

  if (!match) {
    throw new Error(
      `No encontré el puerto ${VIDEO_PORT} en runtime.ports. Revisa que el template exponga el puerto ${VIDEO_PORT}.`
    );
  }

  // RunPod normalmente entrega ip+publicPort para el proxy.
  // Ejemplo: https://xxxx-8000.proxy.runpod.net
  // A veces "ip" ya viene como dominio proxy.
  // Si match.ip ya es un dominio, lo usamos.
  // Si no, armamos con formato proxy.
  const ip = match.ip;

  // Si ya te devuelve un dominio tipo "xxxxx.proxy.runpod.net", úsalo.
  if (ip && ip.includes("proxy.runpod.net")) {
    return ip.startsWith("http") ? ip : `https://${ip}`;
  }

  // Fallback: si solo tenemos publicPort, y el podId, armamos estilo:
  // https://{podId}-{publicPort}.proxy.runpod.net
  // (este formato es el que RunPod muestra en UI “Port 8000 -> worker”)
  const publicPort = match.publicPort;
  if (!publicPort) throw new Error("Port match no tiene publicPort, no puedo construir proxy URL");

  return `https://${pod.id}-${publicPort}.proxy.runpod.net`;
}

// 5) Esperar worker listo
async function waitForWorkerReady(workerBase, maxMs = 6 * 60 * 1000) {
  const start = Date.now();
  const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;

  const candidates = [`${base}/health`, `${base}/api/video`];

  while (Date.now() - start < maxMs) {
    for (const url of candidates) {
      try {
        const r = await fetch(url, { method: "GET" });
        if (r.ok) return true;
        if (r.status === 405) return true;
        if (r.status === 401 || r.status === 403) return true;
      } catch {}
    }
    await sleep(2000);
  }
  throw new Error("Worker not ready: no respondió /health o /api/video");
}

// 6) Terminar pod
async function terminatePod(podId) {
  const mutation = `
    mutation TerminatePod($podId: String!) {
      podTerminate(input: { podId: $podId }) {
        id
      }
    }
  `;
  try {
    await runpodGraphQL(mutation, { podId });
  } catch (e) {
    // No rompemos la respuesta al usuario si terminate falla
    console.error("terminatePod failed:", e?.message || e);
  }
}

// =====================
// Main
// =====================
async function ensureFreshPodAndWorker(sb) {
  // Lock
  const got = await acquireLock(sb);
  if (!got.ok) {
    await waitForUnlock(sb);
    return await ensureFreshPodAndWorker(sb);
  }

  await setPodState(sb, { status: "CREATING", last_used_at: new Date().toISOString() });

  // 1) Create pod from template
  const podId = await createPodFromTemplate();
  await setPodState(sb, { status: "STARTING", pod_id: podId, last_used_at: new Date().toISOString() });

  // 2) Wait running
  const pod = await waitUntilRunning(podId);

  // 3) Build proxy URL for port 8000
  const workerBase = buildProxyUrlFromPod(pod);

  await setPodState(sb, {
    status: "RUNNING",
    worker_url: workerBase,
    pod_id: podId,
    last_used_at: new Date().toISOString(),
  });

  // 4) Wait worker ready
  await waitForWorkerReady(workerBase);

  return { podId, workerBase };
}

// =====================
// API Route
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  let podId = null;

  try {
    const sb = sbAdmin();

    const { podId: createdPodId, workerBase } = await ensureFreshPodAndWorker(sb);
    podId = createdPodId;

    // Proxy a /api/video del worker
    const base = workerBase.endsWith("/") ? workerBase.slice(0, -1) : workerBase;
    const url = `${base}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    await setPodState(sb, { status: "DONE", last_used_at: new Date().toISOString() });

    // Terminar pod (si quieres)
    if (TERMINATE_AFTER_REQUEST && podId) {
      await setPodState(sb, { status: "TERMINATING" });
      await terminatePod(podId);
      await setPodState(sb, { status: "TERMINATED" });
    }

    return res.status(r.status).json(data);
  } catch (e) {
    const msg = String(e?.message || e);

    try {
      const sb = sbAdmin();
      await setPodState(sb, { status: "ERROR", last_used_at: new Date().toISOString(), error: msg });
    } catch {}

    // Intentar terminar pod si ya lo alcanzamos a crear
    if (TERMINATE_AFTER_REQUEST && podId) {
      await terminatePod(podId);
    }

    return res.status(500).json({ ok: false, error: msg });
  }
}
