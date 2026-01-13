// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - API de Generación de Video (Vercel Function)
// ============================================================
//
// Cambios CLAVE:
// 1) Lock atómico REAL con RPC (Postgres) para evitar falsos LOCK_OCUPADO.
// 2) Si ya existe jobRow y falla algo -> update status=ERROR (no más PENDING infinito).
// 3) 429 SOLO cuando lock realmente está tomado.
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

// TTL del lock (segundos)
const LOCK_TTL_SECONDS = parseInt(process.env.VIDEO_LOCK_TTL_SECONDS || "120", 10);

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

const WORKER_HEALTH_PATH = process.env.VIDEO_WORKER_HEALTH_PATH || "/health";
const WORKER_API_PATH = process.env.VIDEO_WORKER_API_PATH || "/api/video_async";

const TERMINATE_AFTER_JOB = (process.env.TERMINATE_AFTER_JOB || "0") === "1";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Falta SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runpodFetch(path, { method = "GET", body } = {}) {
  if (!RUNPOD_API_KEY) throw new Error("Falta RUNPOD_API_KEY / VIDEO_RUNPOD_API_KEY");

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
    const err = new Error(`RunPod ${method} ${path} falló (${res.status}): ${text}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ------------------------------------------------------------
// LOCK - SOLUCIÓN REAL: RPC atómico en Postgres
// ------------------------------------------------------------
//
// Requiere 2 RPC en Supabase (te paso el SQL abajo):
// - acquire_pod_lock(ttl_seconds int) -> devuelve { ok, locked_until, now_utc }
// - release_pod_lock() -> libera
//
// Si NO existen aún, hace fallback al método viejo,
// pero el recomendado (y el que corta el problema de raíz) es el RPC.
//
// ------------------------------------------------------------
async function adquirirLock(sb, log) {
  // 1) Intentar RPC
  try {
    const { data, error } = await sb.rpc("acquire_pod_lock", {
      ttl_seconds: LOCK_TTL_SECONDS,
    });
    if (error) throw error;

    // data puede venir como objeto o array según cómo lo definiste
    const row = Array.isArray(data) ? data?.[0] : data;

    if (row?.ok) {
      return { ok: true, locked_until: row.locked_until, via: "rpc" };
    }
    return { ok: false, motivo: "LOCK_OCUPADO", via: "rpc", debug: row || data };
  } catch (e) {
    log("lock_rpc_fallo, uso fallback", e?.message || e);
  }

  // 2) Fallback (menos confiable)
  const now = new Date().toISOString();
  const until = new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString();

  const { data, error } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: until })
    .eq("id", 1)
    .or(`locked_until.is.null,locked_until.lte.${now}`)
    .select("id, locked_until");

  if (error) throw error;

  if (!data || data.length === 0) {
    return { ok: false, motivo: "LOCK_OCUPADO", via: "fallback" };
  }

  return { ok: true, locked_until: until, via: "fallback" };
}

async function liberarLock(sb, log) {
  // 1) Intentar RPC
  try {
    const { error } = await sb.rpc("release_pod_lock");
    if (error) throw error;
    return { ok: true, via: "rpc" };
  } catch (e) {
    log("release_rpc_fallo, uso fallback", e?.message || e);
  }

  // 2) Fallback
  const pastIso = new Date(Date.now() - 1000).toISOString();
  await sb.from(POD_LOCK_TABLE).update({ locked_until: pastIso }).eq("id", 1);
  return { ok: true, via: "fallback" };
}

// ------------------------------------------------------------
// RunPod - Crear pod desde template
// ------------------------------------------------------------
async function runpodCrearPodDesdeTemplate() {
  if (!VIDEO_TEMPLATE_ID) throw new Error("Falta VIDEO_RUNPOD_TEMPLATE_ID");

  const body = { templateId: VIDEO_TEMPLATE_ID };

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
    throw new Error(`No pude obtener podId al crear pod: ${JSON.stringify(created)}`);
  }

  return podId;
}

async function runpodGetPod(podId) {
  return await runpodFetch(`/v2/pods/${podId}`, { method: "GET" });
}

async function runpodTerminarPod(podId) {
  await runpodFetch(`/v2/pods/${podId}`, { method: "DELETE" });
}

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

async function esperarWorker(workerBase) {
  const t0 = Date.now();
  while (Date.now() - t0 < WAIT_WORKER_TIMEOUT_MS) {
    try {
      const res = await fetch(`${workerBase}${WORKER_HEALTH_PATH}`, { method: "GET" });
      if (res.ok) return true;
    } catch {}
    await sleep(POLL_MS);
  }
  throw new Error("Tiempo de espera agotado: el worker no respondió");
}

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
  let lockTomado = false;
  let jobRow = null; // <- importante para poder cerrarlo en ERROR si algo falla

  try {
    log("step=INICIO");

    // 1) LOCK
    log("step=LOCK_INICIO");
    const lock = await adquirirLock(sb, log);

    if (!lock.ok) {
      log("step=LOCK_OCUPADO", { via: lock.via, debug: lock.debug || null });
      return res.status(429).json({
        error:
          "Sistema ocupado: ya hay una generación en proceso. Intenta de nuevo en unos segundos.",
        code: "LOCK_OCUPADO",
        via: lock.via,
      });
    }

    lockTomado = true;
    log("step=LOCK_OK", { locked_until: lock.locked_until, via: lock.via });

    // 2) Payload
    const {
      prompt = "",
      negativePrompt = "",
      steps = 25,
      userId = null,
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      throw new Error("Falta prompt (texto) para generar el video.");
    }

    // 3) Insert job (solo después del lock OK)
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

    // 4) Crear pod
    log("step=CREATE_POD_REQUEST");
    podId = await runpodCrearPodDesdeTemplate();
    log("step=CREATE_POD_OK", { podId });

    // pod_state (opcional)
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
      log("Aviso: no pude actualizar pod_state.", e?.message || e);
    }

    // 5) Esperar RUNNING
    log("step=WAIT_RUNNING_INICIO", { podId });
    await esperarPodRunning(podId);
    log("step=WAIT_RUNNING_OK", { podId });

    const workerBase = construirWorkerBase(podId);

    // 6) Esperar worker
    log("step=WAIT_WORKER_INICIO", { workerBase });
    await esperarWorker(workerBase);
    log("step=WAIT_WORKER_OK", { workerBase });

    // 7) Enviar job al worker
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

    // 8) Update job
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
      log("Aviso: no pude actualizar video_job.", e?.message || e);
    }

    // 9) Responder al front
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

    // ✅ FIX: si ya existe jobRow, lo cerramos en ERROR (no dejamos PENDING)
    try {
      const sb2 = sbAdmin();
      if (jobRow?.id) {
        await sb2
          .from(VIDEO_JOBS_TABLE)
          .update({
            status: "ERROR",
            error: msg,
            pod_id: podId || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobRow.id);
      } else {
        // si no existía job, insert opcional de error (no es PENDING)
        await sb2.from(VIDEO_JOBS_TABLE).insert([
          {
            status: "ERROR",
            error: msg,
            pod_id: podId || null,
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      // ignorar
    }

    return res.status(500).json({ error: msg });
  } finally {
    // Liberar lock siempre
    try {
      if (lockTomado) {
        const sb3 = sbAdmin();
        await liberarLock(sb3, log);
      }
    } catch {}

    // Terminar pod al final si aplica
    try {
      if (TERMINATE_AFTER_JOB && podId) {
        await runpodTerminarPod(podId);
      }
    } catch {}
  }
}