// /api/autosleep.js
// ============================================================
// IsabelaOS Studio - AutoSleep (Vercel Cron)
//
// NUEVO COMPORTAMIENTO (ON-DEMAND):
// 1) Lee pod_state.last_used_at en Supabase
// 2) Si lleva X minutos sin uso:
//    - Termina (DELETE) el pod (NO stop) para evitar cobros por pod pausado
// 3) NO termina si el sistema indica que el pod está trabajando
//
// Requisitos:
// - Env Vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// - Env Vars: RUNPOD_API_KEY (o VIDEO_RUNPOD_API_KEY)
// - Supabase: tabla pod_state con row id=1 y campos: pod_id, status, last_used_at, worker_url (opcional)
//
// Recomendado:
// - /api/generate-video setea status:
//   CREATING -> STARTING -> RUNNING -> BUSY (durante /api/video) -> RUNNING/IDLE -> TERMINATING -> TERMINATED
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Usa el API key de video si existe
const RUNPOD_API_KEY =
  process.env.VIDEO_RUNPOD_API_KEY || process.env.RUNPOD_API_KEY;

// Minutos sin uso antes de TERMINAR
// Tu pedido: 3 minutos
const IDLE_MINUTES = Number(process.env.POD_IDLE_MINUTES || 3);

const POD_STATE_TABLE = "pod_state";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

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
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Si ya no existe, RunPod suele devolver 404
    const msg = `RunPod GET failed (${r.status}): ${JSON.stringify(data)}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function runpodTerminatePod(podId) {
  // TERMINATE real (DELETE)
  const url = `https://rest.runpod.io/v1/pods/${podId}`;
  const r = await fetch(url, { method: "DELETE", headers: runpodHeaders() });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`RunPod TERMINATE failed (${r.status}): ${t}`);
  }
  return true;
}

// Define cuáles estados consideramos "trabajando"
// Ajusta si tú usas otros strings.
function isBusyStatus(statusRaw) {
  const s = String(statusRaw || "").toUpperCase();
  return (
    s === "CREATING" ||
    s === "STARTING" ||
    s === "BUSY" ||
    s === "GENERATING" ||
    s === "TERMINATING"
  );
}

export default async function handler(req, res) {
  try {
    const sb = sbAdmin();

    const { data: state, error } = await sb
      .from(POD_STATE_TABLE)
      .select("*")
      .eq("id", 1)
