// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - API de Generación de Video (Vercel Function)
//
// MODO B (tu caso): "Crear un POD nuevo por cada generación"
// - Usa un LOCK en Supabase para evitar 2 requests simultáneos.
// - Crea un Pod desde Template en RunPod.
// - Espera a RUNNING.
// - Hace "wake" (si aplica) y espera a que el worker responda.
// - Envía el payload al worker (/api/video_async o /api/video).
// - (Opcional) Termina el pod al final si TERMINATE_AFTER_JOB=1.
//
// ✅ Corrección principal de hoy:
// RunPod rechazaba el body por usar `gpuTypeId` (singular).
// El schema pide `gpuTypeIds` (plural) y en formato array.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod
const RUNPOD_API_KEY = process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;
const RUNPOD_TEMPLATE_ID = process.env.VIDEO_RUNPOD_TEMPLATE_ID || process.env.RUNPOD_TEMPLATE_ID || null;

// GPU (opcional, depende del endpoint / cuenta / región)
// Ej: "NVIDIA A100-SXM4-80GB" o "A100_SXM" según tu configuración.
// Si no lo usas, déjalo vacío y NO se enviará al body.
const RUNPOD_GPU_TYPE = process.env.VIDEO_RUNPOD_GPU_TYPE || process.env.RUNPOD_GPU_TYPE || "";

// Worker
const WORKER_PORT = parseInt(process.env.VIDEO_WORKER_PORT || "8000", 10);
const WORKER_HEALTH_PATH = process.env.VIDEO_WORKER_HEALTH_PATH || "/health";

// Endpoints del worker (según tu imagen/worker)
// Si tu worker solo tiene uno, deja el otro igual y el código intenta ambos.
const WORKER_VIDEO_ASYNC_PATH = process.env.VIDEO_WORKER_ASYNC_PATH || "/api/video_async";
const WORKER_VIDEO_PATH = process.env.VIDEO_WORKER_PATH || "/api/video";

// Opcional: terminar pod al finalizar
const TERMINATE_AFTER_JOB = (process.env.TERMINATE_AFTER_JOB || "0") === "1";

// Reintentos/esperas
const WAIT_RUNNING_TIMEOUT_MS = parseInt(process.env.WAIT_RUNNING_TIMEOUT_MS || "240000", 10); // 4 min
const WAIT_WORKER_TIMEOUT_MS = parseInt(process.env.WAIT_WORKER_TIMEOUT_MS || "180000", 10); // 3 min
const WAIT_WORKER_INTERVAL_MS = parseInt(process.env.WAIT_WORKER_INTERVAL_MS || "4000", 10);

// Cobro
const COSTO_JADES_POR_VIDEO = parseInt(process.env.COSTO_JADES_POR_VIDEO || "10", 10);

// Tablas
const POD_LOCK_TABLE = process.env.POD_LOCK_TABLE || "pod_lock";
const VIDEO_JOBS_TABLE = process.env.VIDEO_JOBS_TABLE || "video_jobs";

// ============================================================
// Helpers
// ============================================================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: r.ok, status: r.status, body };
}

function ahoraISO() {
  return new Date().toISOString();
}

function workerBaseFromPodId(podId) {
  // RunPod proxy: https://{podId}-{PORT}.proxy.runpod.net
  return `https://${podId}-${WORKER_PORT}.proxy.runpod.net`;
}

// ============================================================
// LOCK en Supabase (simple y efectivo)
// - Usa una fila única con clave "video_generate"
// ============================================================
async function adquirirLock(sb) {
  const lockKey = "video_generate";
  const now = Date.now();

  // Intento: upsert con "owner" y "locked_at"
  // Si ya existe y está bloqueado muy reciente, se considera ocupado.
  const { data: existing, error: readErr } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("lock_key", lockKey)
    .maybeSingle();

  if (readErr) throw readErr;

  // Si hay lock y no está viejo, rechazamos
  // (TTL: 10 min por seguridad)
  const TTL_MS = 10 * 60 * 1000;

  if (existing?.locked_at) {
    const lockedAt = new Date(existing.locked_at).getTime();
    if (now - lockedAt < TTL_MS) {
      return { ok: false, motivo: "LOCK_OCUPADO" };
    }
  }

  const payload = {
    lock_key: lockKey,
    locked_at: new Date().toISOString(),
    owner: `vercel_${Math.random().toString(16).slice(2)}`,
  };

  const { error: upErr } = await sb.from(POD_LOCK_TABLE).upsert(payload, { onConflict: "lock_key" });
  if (upErr) throw upErr;

  return { ok: true, lockKey };
}

async function liberarLock(sb) {
  const lockKey = "video_generate";
  await sb.from(POD_LOCK_TABLE).delete().eq("lock_key", lockKey);
}

// ============================================================
// RunPod REST
// ============================================================
async function runpodCrearPodDesdeTemplate({ templateId }) {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");
  if (!templateId) throw new Error("Falta RUNPOD_TEMPLATE_ID / VIDEO_RUNPOD_TEMPLATE_ID");

  const url = "https://api.runpod.io/graphql";

  // ✅ IMPORTANTE:
  // Tu error decía que mandabas `gpuTypeId` y RunPod quería `gpuTypeIds`.
  // Aquí NO enviamos gpuTypeId NUNCA.
  // Si RUNPOD_GPU_TYPE existe, lo mandamos como gpuTypeIds: [RUNPOD_GPU_TYPE]
  const variables = {
    input: {
      // Algunos templates se crean con todo fijo. Aun así, RunPod permite override en algunos casos.
      // Si tu cuenta/endpoint no admite esto, puedes dejarlo vacío (y no se envía).
      ...(RUNPOD_GPU_TYPE ? { gpuTypeIds: [RUNPOD_GPU_TYPE] } : {}),
      templateId,
    },
  };

  // Mutación típica (puede variar por cuenta/version, pero este patrón te funciona con REST GraphQL)
  const query = `
    mutation CrearPod($input: PodCreateInput!) {
      podCreate(input: $input) {
        id
      }
    }
  `;

  const { ok, status, body } = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!ok) {
    throw new Error(`RunPod create pod falló (${status}): ${JSON.stringify(body)}`);
  }

  const podId = body?.data?.podCreate?.id;
  if (!podId) {
    throw new Error(`RunPod create pod no devolvió id: ${JSON.stringify(body)}`);
  }

  return podId;
}

async function runpodGetPod(podId) {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");
  const url = "https://api.runpod.io/graphql";

  const query = `
    query Pod($id: String!) {
      pod(input: { podId: $id }) {
        id
        desiredStatus
        runtime {
          uptimeInSeconds
          ports
        }
        machine {
          gpuCount
          gpuDisplayName
        }
        state
      }
    }
  `;

  const { ok, status, body } = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables: { id: podId } }),
  });

  if (!ok) {
    throw new Error(`RunPod get pod falló (${status}): ${JSON.stringify(body)}`);
  }

  const pod = body?.data?.pod;
  if (!pod) {
    // Esto es lo que te salía como "pod not found"
    throw new Error(`RunPod get pod: pod no encontrado (${JSON.stringify(body)})`);
  }

  return pod;
}

async function runpodEsperarRunning(podId) {
  const t0 = Date.now();
  while (true) {
    const pod = await runpodGetPod(podId);

    const estado = pod?.state || pod?.desiredStatus || "DESCONOCIDO";
    console.log("[GV] estado pod:", estado, "podId=", podId);

    // RunPod puede devolver "RUNNING" o estados similares según API
    if (String(estado).toUpperCase().includes("RUNNING")) {
      return pod;
    }

    if (Date.now() - t0 > WAIT_RUNNING_TIMEOUT_MS) {
      throw new Error(`Timeout esperando RUNNING (podId=${podId})`);
    }

    await sleep(3000);
  }
}

async function runpodTerminarPod(podId) {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");
  const url = "https://api.runpod.io/graphql";

  const query = `
    mutation TerminarPod($id: String!) {
      podTerminate(input: { podId: $id }) {
        id
      }
    }
  `;

  const { ok, status, body } = await fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables: { id: podId } }),
  });

  if (!ok) {
    throw new Error(`RunPod terminate falló (${status}): ${JSON.stringify(body)}`);
  }
}

// ============================================================
// Worker
// ============================================================
async function esperarWorkerOperativo(workerBase) {
  const t0 = Date.now();

  while (true) {
    const url = `${workerBase}${WORKER_HEALTH_PATH}`;
    const r = await fetch(url, { method: "GET" }).catch(() => null);

    if (r && r.ok) {
      return true;
    }

    if (Date.now() - t0 > WAIT_WORKER_TIMEOUT_MS) {
      throw new Error(`Timeout esperando worker operativo en ${url}`);
    }

    await sleep(WAIT_WORKER_INTERVAL_MS);
  }
}

async function enviarTrabajoAlWorker(workerBase, payload) {
  // Intento 1: /api/video_async
  {
    const url = `${workerBase}${WORKER_VIDEO_ASYNC_PATH}`;
    const { ok, status, body } = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (ok) return { ok: true, endpoint: WORKER_VIDEO_ASYNC_PATH, status, body };

    console.log("[GV] worker respondió error en async:", status, body);
  }

  // Intento 2: /api/video
  {
    const url = `${workerBase}${WORKER_VIDEO_PATH}`;
    const { ok, status, body } = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (ok) return { ok: true, endpoint: WORKER_VIDEO_PATH, status, body };

    return { ok: false, endpoint: WORKER_VIDEO_PATH, status, body };
  }
}

// ============================================================
// Handler principal
// ============================================================
export default async function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido" });

  const sb = sbAdmin();

  console.log("[GV] step=INICIO");

  let lockOk = false;
  let podId = null;

  try {
    // 1) Validar payload mínimo
    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    const negative_prompt = String(body.negative_prompt || "").trim();
    const steps = Number.isFinite(Number(body.steps)) ? Number(body.steps) : 25;

    if (!prompt) {
      return json(res, 400, { error: "Falta prompt" });
    }

    if (!RUNPOD_TEMPLATE_ID) {
      return json(res, 500, { error: "Falta VIDEO_RUNPOD_TEMPLATE_ID / RUNPOD_TEMPLATE_ID" });
    }

    // 2) Lock
    console.log("[GV] step=LOCK_INICIO");
    const lock = await adquirirLock(sb);
    if (!lock.ok) {
      console.log("[GV] step=LOCK_OCUPADO");
      return json(res, 429, { error: "Servidor ocupado. Intenta de nuevo en unos segundos." });
    }
    lockOk = true;
    console.log("[GV] step=LOCK_OK");

    // 3) Guardar job (opcional)
    const jobRow = {
      created_at: ahoraISO(),
      prompt,
      negative_prompt,
      steps,
      costo_jades: COSTO_JADES_POR_VIDEO,
      estado: "CREANDO_POD",
    };

    const { data: jobInsert, error: jobErr } = await sb
      .from(VIDEO_JOBS_TABLE)
      .insert(jobRow)
      .select("*")
      .maybeSingle();

    if (jobErr) {
      // No detiene la generación, solo log
      console.log("[GV] aviso: no se pudo insertar video_job:", jobErr?.message || jobErr);
    }

    // 4) Crear pod desde template
    console.log("[GV] step=CREATE_POD_REQUEST");
    podId = await runpodCrearPodDesdeTemplate({ templateId: RUNPOD_TEMPLATE_ID });
    console.log("[GV] step=CREATE_POD_OK podId=", podId);

    // 5) Esperar RUNNING
    console.log("[GV] step=WAIT_RUNNING_INICIO", { podId });
    await runpodEsperarRunning(podId);
    console.log("[GV] step=WAIT_RUNNING_OK", { podId });

    // 6) Armar URL pública del worker
    const workerBase = workerBaseFromPodId(podId);
    console.log("[GV] workerBase=", workerBase);

    // 7) Esperar worker listo
    console.log("[GV] step=WAIT_WORKER_INICIO");
    await esperarWorkerOperativo(workerBase);
    console.log("[GV] step=WAIT_WORKER_OK");

    // 8) Enviar payload al worker
    console.log("[GV] step=ENVIAR_TRABAJO");

    const payloadWorker = {
      prompt,
      negative_prompt,
      steps,
      // Puedes pasar más campos si tu worker los usa:
      // width: body.width,
      // height: body.height,
      // seed: body.seed,
      // etc...
    };

    const rWorker = await enviarTrabajoAlWorker(workerBase, payloadWorker);

    if (!rWorker.ok) {
      console.log("[GV] fatal: Worker falló", rWorker.status, rWorker.body);
      throw new Error(`Worker falló (${rWorker.status}): ${JSON.stringify(rWorker.body)}`);
    }

    console.log("[GV] step=WORKER_OK", rWorker.endpoint);

    // 9) (Opcional) terminar pod para ahorrar
    if (TERMINATE_AFTER_JOB && podId) {
      console.log("[GV] step=TERMINATE_POD_INICIO");
      await runpodTerminarPod(podId);
      console.log("[GV] step=TERMINATE_POD_OK");
      podId = null;
    }

    // 10) Respuesta
    return json(res, 200, {
      ok: true,
      mensaje: "Trabajo enviado al motor de video.",
      podId: podId || null,
      workerEndpoint: rWorker.endpoint,
      resultado: rWorker.body,
      costo_jades: COSTO_JADES_POR_VIDEO,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    console.log("[GV] fatal:", msg);

    // Si por configuración quieres terminar pod cuando hay error, lo puedes activar aquí:
    // (por defecto NO lo hago para que puedas inspeccionar)
    // if (podId) { try { await runpodTerminarPod(podId); } catch {} }

    return json(res, 500, { error: msg });
  } finally {
    // Liberar lock pase lo que pase
    if (lockOk) {
      try {
        await liberarLock(sb);
        console.log("[GV] step=LOCK_LIBERADO");
      } catch (err) {
        console.log("[GV] aviso: no se pudo liberar lock:", err?.message || err);
      }
    }
  }
}
