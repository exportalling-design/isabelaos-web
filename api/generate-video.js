import { createClient } from "@supabase/supabase-js";

// ============================================================
// IsabelaOS Studio - API Route: Generate Video (Proxy + Pod Control)
// ------------------------------------------------------------
// ¿Qué hace este archivo?
// 1) Valida que sea POST
// 2) Asegura que exista UN solo pod listo (RUNNING) sin duplicar pods
//    - Usa Supabase como "estado único": pod_state (id=1)
//    - Usa Supabase como "lock" anti-concurrencia: pod_lock (id=1)
// 3) Hace proxy (fetch) hacia tu worker dentro del pod: /api/video
// 4) Actualiza last_used_at para que autosleep pueda apagarlo luego
//
// NOTA: STOP ≠ TERMINATE
// - STOP: apaga GPU, mantiene disco/archivos/modelos (lo que quieres)
// - TERMINATE: puede borrar o destruir recursos (NO lo usamos)
// ============================================================

// =====================
// ENV (Vercel)
// =====================
// Deben estar configuradas en Vercel -> Project -> Settings -> Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // backend only (NO exponer al frontend)

// RunPod credentials (aquí NO se usan directamente aún porque faltan stubs)
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_TEMPLATE_ID = process.env.RUNPOD_TEMPLATE_ID; // tu template A6000

// Si tu worker URL es FIJA (pod siempre igual, IP/URL constante), puedes setear esto
// y te saltas runpodCreate/runpodGet. Si NO es fija, déjalo vacío.
const VIDEO_WORKER_URL = process.env.VIDEO_WORKER_URL;

// =====================
// Tablas de Supabase
// =====================
// Pod state: 1 fila global (id=1) donde guardas pod_id, status, worker_url, last_used_at
const POD_STATE_TABLE = "pod_state";

// Pod lock: 1 fila global (id=1) para evitar carreras cuando llegan requests simultáneos
const POD_LOCK_TABLE = "pod_lock";

// =====================
// Settings (tuneables)
// =====================
const LOCK_SECONDS = 90;         // cuánto dura el lock (si un request se muere, se libera solo)
const READY_TIMEOUT_MS = 180000; // 3 min max esperando a que el pod esté RUNNING
const POLL_MS = 3000;            // cada cuánto preguntamos estado del pod cuando está encendiendo

// ============================================================
// Supabase Admin Client (Service Role)
// - Esto es backend-only. Con esto puedes leer/escribir tablas sin RLS (si lo necesitas)
// ============================================================
function sbAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase admin env missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ============================================================
// SUPABASE LOCK (anti-concurrencia)
// ------------------------------------------------------------
// Problema que resuelve:
// - Si 3 personas le dan "Generar" al mismo tiempo, sin lock podrían crearse 3 pods.
// - Con lock: solo 1 request "gana", los otros esperan hasta que el pod esté RUNNING.
// ============================================================

/**
 * Intentar adquirir el lock.
 * Retorna { ok: true } si lo adquirió, o { ok:false, locked_until } si está tomado.
 */
async function acquireLock(sb) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  // 1) Leer row id=1 del lock
  const { data: row, error: readErr } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("id", 1)
    .single();

  if (readErr) {
    throw new Error("No existe pod_lock id=1 (crea tabla + row en Supabase)");
  }

  // 2) Si el lock aún está vigente, no se puede tomar
  const current = row.locked_until ? new Date(row.locked_until) : null;
  if (current && current > now) {
    return { ok: false, locked_until: row.locked_until };
  }

  // 3) Tomar lock actualizando locked_until
  const { error: updErr } = await sb
    .from(POD_LOCK_TABLE)
    .update({ locked_until: lockedUntil })
    .eq("id", 1);

  // Si falló por concurrencia, devolvemos "no ok"
  if (updErr) return { ok: false, locked_until: row.locked_until };

  return { ok: true, locked_until: lockedUntil };
}

/**
 * Espera hasta que el lock se libere (locked_until <= now)
 */
async function waitForUnlock(sb) {
  while (true) {
    const { data, error } = await sb
      .from(POD_LOCK_TABLE)
      .select("*")
      .eq("id", 1)
      .single();

    if (error) throw error;

    const until = data.locked_until ? new Date(data.locked_until) : null;
    const now = new Date();

    if (!until || until <= now) return true;

    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ============================================================
// POD STATE Helpers
// ------------------------------------------------------------
// pod_state (id=1) guarda:
// - pod_id: string
// - status: STOPPED | STARTING | RUNNING | ERROR
// - worker_url: base url del worker (por ejemplo https://xxxxx.proxy.runpod.net)
// - last_used_at: timestamp del último uso (para autosleep)
// ============================================================

async function getPodState(sb) {
  const { data, error } = await sb
    .from(POD_STATE_TABLE)
    .select("*")
    .eq("id", 1)
    .single();

  if (error) throw new Error("No existe pod_state id=1 (crea row en Supabase)");
  return data;
}

async function setPodState(sb, patch) {
  const { error } = await sb
    .from(POD_STATE_TABLE)
    .update(patch)
    .eq("id", 1);

  if (error) throw error;
}

// ============================================================
// RUNPOD API (STUBS)
// ------------------------------------------------------------
// Aquí NO adivino tus endpoints exactos porque RunPod se puede controlar
// por GraphQL o REST y tus llamadas ya dependen de tu implementación.
// Pégame tus funciones reales y las integro aquí.
//
// Esperado:
// - runpodCreatePod(): crea (o clona desde template) y retorna { pod_id, worker_url? }
// - runpodGetPod(pod_id): retorna { status, worker_url? }
// - runpodStopPod(pod_id): hace STOP (NO terminate)
// ============================================================

async function runpodCreatePod() {
  // return { pod_id, worker_url }
  // throw new Error(...) para que quede obvio que falta implementar
  throw new Error("runpodCreatePod() no implementado: pega tu llamada RunPod aquí");
}

async function runpodGetPod(pod_id) {
  // return { status: "RUNNING"|"STOPPED"|..., worker_url }
  throw new Error("runpodGetPod() no implementado: pega tu llamada RunPod aquí");
}

async function runpodStopPod(pod_id) {
  // stop pod (NO terminate)
  throw new Error("runpodStopPod() no implementado: pega tu llamada RunPod aquí");
}

// ============================================================
// ensurePodRunning()
// ------------------------------------------------------------
// Objetivo:
// - Retornar worker_url listo para usar (RUNNING)
// - Evitar crear pods duplicados con el lock
//
// Flujo:
// 1) Intentar adquirir lock
// 2) Si otro request lo tiene, esperar unlock y reintentar
// 3) Leer pod_state
// 4) Si VIDEO_WORKER_URL está definida -> se usa directo
// 5) Si no hay pod_id o no está RUNNING:
//    - marcar STARTING
//    - crear pod si no existe
//    - poll a RunPod hasta RUNNING
//    - guardar worker_url + status RUNNING + last_used_at
// 6) Si ya está RUNNING -> solo actualiza last_used_at y retorna worker_url
// ============================================================

async function ensurePodRunning(sb) {
  // 1) adquirir lock global
  const got = await acquireLock(sb);

  if (!got.ok) {
    // Otro request está encendiendo el pod -> esperamos a que libere lock
    await waitForUnlock(sb);
    // Reintento (sin recursión infinita: reintenta normalmente)
    return await ensurePodRunning(sb);
  }

  // 2) leer estado actual del pod
  let state = await getPodState(sb);

  // 3) Shortcut: si tu VIDEO_WORKER_URL es fija (pod único estable)
  //    entonces asumimos RUNNING y guardamos worker_url para el resto del sistema.
  if (VIDEO_WORKER_URL) {
    await setPodState(sb, {
      status: "RUNNING",
      worker_url: VIDEO_WORKER_URL,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return VIDEO_WORKER_URL;
  }

  // 4) Si no hay pod_id o no está RUNNING, hay que encender/crear
  if (!state.pod_id || state.status !== "RUNNING") {
    // Marcar que estamos iniciando (STARTING) para que el autosleep no lo toque
    await setPodState(sb, {
      status: "STARTING",
      updated_at: new Date().toISOString(),
    });

    // (A) Si NO hay pod_id: creamos uno desde template
    if (!state.pod_id) {
      const created = await runpodCreatePod();

      await setPodState(sb, {
        pod_id: created.pod_id,
        worker_url: created.worker_url || null,
        status: "STARTING",
        updated_at: new Date().toISOString(),
      });

      // refrescamos state para seguir con polling
      state = await getPodState(sb);
    }

    // (B) Poll de estado hasta que llegue a RUNNING/READY
    const start = Date.now();

    while (Date.now() - start < READY_TIMEOUT_MS) {
      const st = await runpodGetPod(state.pod_id);

      // Cuando RunPod diga RUNNING, necesitamos worker_url para hacer fetch al worker
      if (st.status === "RUNNING") {
        const worker = st.worker_url || state.worker_url;

        if (!worker) {
          // Está RUNNING pero no tenemos endpoint del worker => no podemos proxyear
          throw new Error("Pod RUNNING pero no hay worker_url (falta st.worker_url o state.worker_url)");
        }

        await setPodState(sb, {
          status: "RUNNING",
          worker_url: worker,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        return worker;
      }

      // Aún no está listo, esperamos y reintentamos
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    // Timeout: no llegó a RUNNING a tiempo
    await setPodState(sb, {
      status: "ERROR",
      updated_at: new Date().toISOString(),
    });

    throw new Error("Timeout: el pod no llegó a RUNNING en 3 min");
  }

  // 5) Si ya está RUNNING, solo actualizamos last_used_at y devolvemos worker_url
  await setPodState(sb, {
    last_used_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return state.worker_url;
}

// ============================================================
// API ROUTE Handler
// ------------------------------------------------------------
// Espera POST con body (prompt/config) y lo envía al worker /api/video
// ============================================================

export default async function handler(req, res) {
  // Solo aceptamos POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const sb = sbAdmin();

    // 1) Asegurar pod listo (sin duplicar pods)
    const workerBase = await ensurePodRunning(sb);

    if (!workerBase) {
      return res.status(500).json({ ok: false, error: "No hay workerBase (worker url)" });
    }

    // 2) Construir URL final del endpoint del worker
    //    Nota: workerBase debería ser tipo: https://xxxx.proxy.runpod.net
    const url = workerBase.endsWith("/")
      ? `${workerBase}api/video`
      : `${workerBase}/api/video`;

    // 3) Proxy request hacia el worker
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // req.body trae el payload que tu frontend manda (prompt, settings, etc.)
      body: JSON.stringify(req.body),
    });

    // Intentamos parsear JSON; si el worker falla y no devuelve JSON, devolvemos {}.
    const data = await r.json().catch(() => ({}));

    // 4) Actualizar last_used_at (para autosleep)
    await setPodState(sb, {
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 5) Responder al frontend con el mismo status del worker
    return res.status(r.status).json(data);
  } catch (e) {
    // Si hay error (env missing, timeout, etc.)
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
