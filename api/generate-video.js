import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // backend only
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
const RUNPOD_TEMPLATE_ID = process.env.RUNPOD_TEMPLATE_ID; // tu template A6000
const VIDEO_WORKER_URL = process.env.VIDEO_WORKER_URL; // si el pod ya existe y es fijo (opcional)

// Estado único del pod
const POD_STATE_TABLE = "pod_state";
const POD_LOCK_TABLE = "pod_lock";

// Settings
const LOCK_SECONDS = 90;
const READY_TIMEOUT_MS = 180000; // 3 min
const POLL_MS = 3000;

function sbAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase admin env missing");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// =====================
// SUPABASE LOCK
// =====================
async function acquireLock(sb) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();

  // intentamos "tomar" lock si está vencido
  // requerimos que exista un row con id=1 (crearlo en dashboard)
  const { data: row, error: readErr } = await sb
    .from(POD_LOCK_TABLE)
    .select("*")
    .eq("id", 1)
    .single();

  if (readErr) throw new Error("No existe pod_lock id=1 (crea row en Supabase)");
  const current = row.locked_until ? new Date(row.locked_until) : null;

  if (current && current > now) {
    return { ok: false, locked_until: row.locked_until };
  }

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
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// =====================
// POD STATE (Supabase)
// =====================
async function getPodState(sb) {
  const { data, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
  if (error) throw new Error("No existe pod_state id=1 (crea row en Supabase)");
  return data;
}

async function setPodState(sb, patch) {
  const { error } = await sb.from(POD_STATE_TABLE).update(patch).eq("id", 1);
  if (error) throw error;
}

// =====================
// RUNPOD API (rellenar)
// =====================
// OJO: aquí no adivino tus endpoints exactos.
// Si ya tienes tu código de RunPod create/stop/status, lo pegamos aquí tal cual.
async function runpodCreatePod() {
  // return { pod_id, worker_url }
  throw new Error("runpodCreatePod() no implementado: pega tu llamada RunPod aquí");
}

async function runpodGetPod(pod_id) {
  // return { status: "RUNNING"|"STOPPED"|..., worker_url }
  throw new Error("runpodGetPod() no implementado: pega tu llamada RunPod aquí");
}

async function runpodStopPod(pod_id) {
  // stop pod
  throw new Error("runpodStopPod() no implementado: pega tu llamada RunPod aquí");
}

async function ensurePodRunning(sb) {
  // 1) lock global
  const got = await acquireLock(sb);
  if (!got.ok) {
    // otro request está encendiendo: esperamos
    await waitForUnlock(sb);
    return await ensurePodRunning(sb); // re-intenta ya sin lock activo
  }

  // 2) leer estado
  let state = await getPodState(sb);

  // si ya hay worker url fija (porque el pod es único y no cambia)
  if (VIDEO_WORKER_URL) {
    await setPodState(sb, { status: "RUNNING", worker_url: VIDEO_WORKER_URL, last_used_at: new Date().toISOString() });
    return VIDEO_WORKER_URL;
  }

  // Si no hay pod o está stopped, lo creamos/encendemos
  if (!state.pod_id || state.status !== "RUNNING") {
    await setPodState(sb, { status: "STARTING" });

    // (A) si no hay pod_id -> creamos
    if (!state.pod_id) {
      const created = await runpodCreatePod();
      await setPodState(sb, { pod_id: created.pod_id, worker_url: created.worker_url || null, status: "STARTING" });
      state = await getPodState(sb);
    }

    // (B) esperamos READY/RUNNING con timeout
    const start = Date.now();
    while (Date.now() - start < READY_TIMEOUT_MS) {
      const st = await runpodGetPod(state.pod_id);
      if (st.status === "RUNNING") {
        const worker = st.worker_url || state.worker_url;
        if (!worker) throw new Error("Pod RUNNING pero no hay worker_url");
        await setPodState(sb, { status: "RUNNING", worker_url: worker, last_used_at: new Date().toISOString() });
        return worker;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    await setPodState(sb, { status: "ERROR" });
    throw new Error("Timeout: el pod no llegó a RUNNING en 3 min");
  }

  // ya está RUNNING
  await setPodState(sb, { last_used_at: new Date().toISOString() });
  return state.worker_url;
}

// =====================
// API ROUTE
// =====================
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const sb = sbAdmin();

    // ✅ 1) asegurar pod ready (sin duplicar pods)
    const workerBase = await ensurePodRunning(sb);
    if (!workerBase) return res.status(500).json({ ok: false, error: "No hay VIDEO_WORKER_URL" });

    // ✅ 2) proxy al pod
    const url = workerBase.endsWith("/") ? `${workerBase}api/video` : `${workerBase}/api/video`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json().catch(() => ({}));

    // ✅ 3) actualizar last_used_at (si se generó algo)
    await setPodState(sb, { last_used_at: new Date().toISOString() });

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
