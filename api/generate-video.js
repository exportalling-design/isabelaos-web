// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - API de Generación de Video (Vercel Function)
// ============================================================
//
// Objetivo:
// - Cobrar 10 jades por video (si lo tienes en tu lógica).
// - Evitar 2 generaciones simultáneas con un LOCK en Supabase.
// - Crear un POD en RunPod desde un TEMPLATE.
// - Esperar a que el POD esté RUNNING.
// - Esperar a que el WORKER responda.
// - Enviar el trabajo al worker (async) y devolver jobId / urls.
//
// IMPORTANTE (TU CASO):
// Tu tabla `pod_lock` NO tiene `lock_key`.
// Solo tiene: `id` y `locked_until`.
// Por eso el lock se implementa con un único registro id=1.
//
// IMPORTANTE (SERVERLESS):
// NO liberamos el lock manualmente. El lock vive por TTL (locked_until).
// ============================================================

import { createClient } from "@supabase/supabase-js";

// ------------------------------------------------------------
// ENV (Vercel)
// ------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY || null;

const VIDEO_TEMPLATE_ID =
  process.env.VIDEO_RUNPOD_TEMPLATE_ID || process.env.RUNPOD_TEMPLATE_ID || null;

// (Opcional) si tu template monta Network Volume
const VIDEO_NETWORK_VOLUME_ID =
  process.env.VIDEO_RUNPOD_NETWORK_VOLUME_ID ||
  process.env.RUNPOD_NETWORK_VOLUME_ID ||
  null;

// Tablas
const POD_LOCK_TABLE = "pod_lock";
const POD_STATE_TABLE = "pod_state";
const VIDEO_JOBS_TABLE = "video_jobs";

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
const COSTO_JADES_VIDEO = 10;

// Lock: cuánto tiempo se reserva el lock (segundos)
const LOCK_TTL_SECONDS = parseInt(
  process.env.VIDEO_LOCK_TTL_SECONDS || "120",
  10
);

// Esperas / reintentos
const WAIT_RUNNING_TIMEOUT_MS = parseInt(
  process.env.VIDEO_WAIT_RUNNING_TIMEOUT_MS || "240000",
  10
); // 4 min

const WAIT_WORKER_TIMEOUT_MS = parseInt(
  process.env.VIDEO_WAIT_WORKER_TIMEOUT_MS || "240000",
  10
); // 4 min

const POLL_MS = parseInt(process.env.VIDEO_POLL_MS || "3000", 10);

// Worker endpoints
const WORKER_HEALTH_PATH = process.env.VIDEO_WORKER_HEALTH_PATH || "/health";
// Cambia esto si tu worker usa otra ruta
const WORKER_API_PATH = process.env.VIDEO_WORKER_API_PATH || "/api/video_async";

// Terminar pod al final (si tu modo es crear/terminar)
const TERMINATE_AFTER_JOB = (process.env.TERMINATE_AFTER_JOB || "0") === "1";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ahoraIso() {
  return new Date().toISOString();
}

function sumarSegundosIso(segundos) {
  return new Date(Date.now() + segundos * 1000).toISOString();
}

async function runpodFetch(path, { method = "GET", body } = {}) {
  if (!RUNPOD_API_KEY)
    throw new Error("Falta RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");

  const url = `https://api.runpod.io${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      `RunPod ${method} ${path} falló (${res.status}): ${text}`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ------------------------------------------------------------
// LOCK (Supabase) usando pod_lock(id=1, locked_until) - SOLO TTL
// ------------------------------------------------------------
//
// Idea:
// - Si locked_until > ahora => lock ocupado.
// - Si locked_until <= ahora (o null) => tomamos lock actualizando locked_until = ahora + TTL.
// - Update condicional para minimizar colisiones.
//
// IMPORTANTE:
// No liberamos el lock en serverless; expira por TTL.
// ------------------------------------------------------------
async function adquirirLock(sb) {
  const nowIso = ahoraIso();
  const untilIso = sumarSegundosIso(LOCK_TTL_SECONDS);

  const { data, error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: untilIso })
    .eq("id", 1)
    .or(`locked_until.is.null,locked_until.lte.${nowIso}`)
    .select("*");

  if (error) throw error;

  if (!data || data.length === 0) {
    return { ok: false, motivo: "LOCK_OCUPADO" };
  }

  return { ok: true, locked_until: untilIso };
}

// ------------------------------------------------------------
// RunPod - Crear pod desde template
// ------------------------------------------------------------
async function runpodCrearPodDesdeTemplate() {
  if (!VIDEO_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");

  const body = {
    templateId: VIDEO_TEMPLATE_ID,
  };

  // Nota: VIDEO_NETWORK_VOLUME_ID se deja por compatibilidad con tu env,
  // pero NO lo mandamos si tu template ya lo maneja.
  // (Si algún día lo necesitas en API: lo agregamos con la key exacta que RunPod espere.)

  const created = await runpodFetch(`/v2/pods`, {
    method: "POST",
    body,
  });

  const podId =
    created?.id ||
    created?.podId ||
    created?.data?.id ||
    created?.data?.podId ||
    null;

  if (!podId) {
    throw new Error(
      `No pude obtener podId al crear pod: ${JSON.stringify(created)}`
    );
  }

  return podId;
}

async function runpodGetPod(podId) {
  return await runpodFetch(`/v2/pods/${podId}`, { method: "GET" });
}

async function runpodTerminarPod(podId) {
  await runpodFetch(`/v2/pods/${podId}`, { method: "DELETE" });
}

// ------------------------------------------------------------
// Esperar a RUNNING
// ------------------------------------------------------------
async function esperarPodRunning(podId) {
  const t0 = Date.now();

  while (Date.now() - t0 < WAIT_RUNNING_TIMEOUT_MS) {
    const pod = await runpodGetPod(podId);
    const status =
      pod?.status || pod?.state || pod?.pod?.status || pod?.data?.status || null;

    if (status === "RUNNING") return pod;

    await sleep(POLL_MS);
  }

  throw new Error("Tiempo de espera agotado: el pod no llegó a RUNNING");
}

// ------------------------------------------------------------
// Esperar worker vivo
// ------------------------------------------------------------
async function esperarWorker(workerBase) {
  const t0 = Date.now();

  while (Date.now() - t0 < WAIT_WORKER_TIMEOUT_MS) {
    try {
      const res = await fetch(`${workerBase}${WORKER_HEALTH_PATH}`, {
        method: "GET",
      });
      if (res.ok) return true;
    } catch {
      // reintentar
    }

    await sleep(POLL_MS);
  }

  throw new Error("Tiempo de espera agotado: el worker no respondió");
}

// ------------------------------------------------------------
// Utilidad: construir URL pública del worker vía proxy runpod
// ------------------------------------------------------------
function construirWorkerBase(podId) {
  return `https://${podId}-8000.proxy.runpod.net`;
}

// ------------------------------------------------------------
// Handler principal
// ------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const sb = sbAdmin();
  const log = (...args) => console.log("[GV]", ...args);

  let podId = null;

  try {
    log("step=INICIO");

    // --------------------------------------------------------
    // 1) LOCK (solo TTL)
    // --------------------------------------------------------
    log("step=LOCK_INICIO");

    const lock = await adquirirLock(sb);
    if (!lock.ok) {
      log("step=LOCK_OCUPADO");
      return res.status(429).json({
        error:
          "Sistema ocupado: ya hay una generación en proceso. Intenta de nuevo en unos segundos.",
        code: "LOCK_OCUPADO",
      });
    }

    log("step=LOCK_OK", { locked_until: lock.locked_until });

    // --------------------------------------------------------
    // 2) Leer payload
    // --------------------------------------------------------
    const {
      prompt = "",
      negativePrompt = "",
      steps = 25,
      userId = null,
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      throw new Error("Falta prompt (texto) para generar el video.");
    }

    // --------------------------------------------------------
    // 3) (Opcional) Registrar job en Supabase
    // --------------------------------------------------------
    let jobRow = null;
    try {
      const insertJob = await sb
        .from(VIDEO_JOBS_TABLE)
        .insert([
          {
            user_id: userId,
            status: "CREANDO_POD",
            prompt,
            negative_prompt: negativePrompt,
            steps: Number(steps) || 25,
            created_at: new Date().toISOString(),
          },
        ])
        .select("*")
        .maybeSingle();

      jobRow = insertJob?.data || null;
    } catch (e) {
      log("Aviso: no pude insertar video_job (continuo igual).", e?.message || e);
    }

    // --------------------------------------------------------
    // 4) Crear pod
    // --------------------------------------------------------
    log("step=CREATE_POD_REQUEST");

    podId = await runpodCrearPodDesdeTemplate();

    log("step=CREATE_POD_OK", { podId });

    // (Opcional) guardar estado pod en pod_state
    try {
      await sb
        .from(POD_STATE_TABLE)
        .upsert(
          [
            {
              id: 1,
              pod_id: podId,
              status: "CREADO",
              updated_at: new Date().toISOString(),
            },
          ],
          { onConflict: "id" }
        );
    } catch (e) {
      log("Aviso: no pude actualizar pod_state (continuo igual).", e?.message || e);
    }

    // --------------------------------------------------------
    // 5) Esperar RUNNING
    // --------------------------------------------------------
    log("step=WAIT_RUNNING_INICIO", { podId });

    await esperarPodRunning(podId);

    log("step=WAIT_RUNNING_OK", { podId });

    const workerBase = construirWorkerBase(podId);

    // --------------------------------------------------------
    // 6) Esperar worker
    // --------------------------------------------------------
    log("step=WAIT_WORKER_INICIO", { workerBase });

    await esperarWorker(workerBase);

    log("step=WAIT_WORKER_OK", { workerBase });

    // --------------------------------------------------------
    // 7) Enviar job al worker (async)
    // --------------------------------------------------------
    log("step=WORKER_REQUEST_INICIO");

    const workerPayload = {
      prompt,
      negative_prompt: negativePrompt,
      steps: Number(steps) || 25,
    };

    const wRes = await fetch(`${workerBase}${WORKER_API_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workerPayload),
    });

    const wText = await wRes.text();
    let wJson = null;
    try {
      wJson = wText ? JSON.parse(wText) : null;
    } catch {
      wJson = { raw: wText };
    }

    if (!wRes.ok) {
      throw new Error(
        `Worker respondió error (${wRes.status}): ${
          typeof wText === "string" ? wText : JSON.stringify(wJson)
        }`
      );
    }

    log("step=WORKER_REQUEST_OK");

    // --------------------------------------------------------
    // 8) Actualizar job en Supabase (si existe)
    // --------------------------------------------------------
    try {
      if (jobRow?.id) {
        await sb
          .from(VIDEO_JOBS_TABLE)
          .update({
            status: "EN_PROCESO",
            pod_id: podId,
            worker_base: workerBase,
            worker_response: wJson,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobRow.id);
      }
    } catch (e) {
      log("Aviso: no pude actualizar video_job (continuo igual).", e?.message || e);
    }

    // --------------------------------------------------------
    // 9) Responder al front
    // --------------------------------------------------------
    return res.status(200).json({
      ok: true,
      podId,
      workerBase,
      job: wJson,
      costo_jades: COSTO_JADES_VIDEO,
      mensaje: "Generación enviada al worker (modo async).",
    });
  } catch (err) {
    const msg = err?.message || String(err);

    console.error("[GV] fatal:", msg);

    // Intento de guardar error en video_jobs si existe
    try {
      const sb2 = sbAdmin();
      await sb2.from(VIDEO_JOBS_TABLE).insert([
        {
          status: "ERROR",
          error: msg,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch {
      // ignorar
    }

    return res.status(500).json({ error: msg });
  } finally {
    // --------------------------------------------------------
    // NO liberar lock manualmente (expira por TTL)
    // --------------------------------------------------------

    // (Opcional) terminar pod al final si tu modo es efímero
    try {
      if (TERMINATE_AFTER_JOB && podId) {
        await runpodTerminarPod(podId);
      }
    } catch {
      // ignorar
    }
  }
}
```0