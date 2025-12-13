// /api/autosleep.js
// ============================================================
// IsabelaOS Studio - AutoSleep (Vercel Cron)
//
// Qué hace:
// 1) Lee pod_state (id=1) en Supabase.
// 2) Calcula minutos de inactividad desde last_used_at.
// 3) Si supera el umbral (POD_IDLE_MINUTES):
//    - Llama a RunPod API para STOP del pod (NO terminate).
//    - Actualiza pod_state.status = STOPPED.
// ============================================================

import { createClient } from "@supabase/supabase-js";

// =====================
// ENV (Vercel)
// =====================
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

// Umbral de inactividad en minutos (recomendado 10-15)
const IDLE_MINUTES = Number(process.env.POD_IDLE_MINUTES || 10);

const POD_STATE_TABLE = "pod_state";

// RunPod GraphQL endpoint (estable)
const RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql";

function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * RunPod GraphQL helper
 * - RunPod usa GraphQL para operaciones sobre Pods
 * - Probamos 2 estilos de auth para ser tolerantes:
 *   1) Authorization: Bearer <key>
 *   2) X-API-KEY: <key>
 */
async function runpodGraphQL(query, variables) {
  if (!RUNPOD_API_KEY) throw new Error("Missing RUNPOD_API_KEY in Vercel");

  // intento 1: Bearer
  let resp = await fetch(RUNPOD_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  // si no funciona, intento 2: X-API-KEY
  if (resp.status === 401 || resp.status === 403) {
    resp = await fetch(RUNPOD_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": RUNPOD_API_KEY,
      },
      body: JSON.stringify({ query, variables }),
    });
  }

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`RunPod GraphQL HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }
  if (json.errors?.length) {
    throw new Error(`RunPod GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/**
 * STOP pod (NO terminate)
 * - STOP conserva tu volumen/archivos (persisten).
 * - TERMINATE borraría el pod completo.
 */
async function runpodStopPod(pod_id) {
  const mutation = `
    mutation StopPod($podId: String!) {
      podStop(podId: $podId)
    }
  `;

  // Nota: algunos esquemas usan podId tipo ID/String.
  // Si tu cuenta devuelve error por tipo, me pegas el error y lo ajustamos.
  const data = await runpodGraphQL(mutation, { podId: pod_id });
  return data;
}

export default async function handler(req, res) {
  try {
    const sb = sbAdmin();

    // 1) leer estado del pod
    const { data: state, error } = await sb.from(POD_STATE_TABLE).select("*").eq("id", 1).single();
    if (error) throw error;

    const last = state.last_used_at ? new Date(state.last_used_at) : null;
    const now = new Date();

    // Si no hay registro de uso, no apagues nada
    if (!last) {
      return res.status(200).json({ ok: true, action: "noop", reason: "no last_used_at" });
    }

    const idleMinutes = (now.getTime() - last.getTime()) / 60000;

    // Si no hay pod_id, estamos en modo manual (solo RP_ENDPOINT) → no se puede parar por API
    if (!state.pod_id) {
      return res.status(200).json({
        ok: true,
        action: "noop",
        reason: "no pod_id in pod_state (agrega RUNPOD_POD_ID en Vercel o guarda pod_id en Supabase)",
        idleMinutes,
      });
    }

    // Si ya está detenido, no hagas nada
    if (state.status === "STOPPED") {
      return res.status(200).json({ ok: true, action: "noop", reason: "already STOPPED", idleMinutes });
    }

    // 2) si no ha pasado el umbral, no apagues
    if (idleMinutes < IDLE_MINUTES) {
      return res.status(200).json({ ok: true, action: "noop", idleMinutes });
    }

    // 3) STOP por inactividad
    await runpodStopPod(state.pod_id);

    // 4) marcar STOPPED en Supabase
    const { error: updErr } = await sb
      .from(POD_STATE_TABLE)
      .update({ status: "STOPPED" })
      .eq("id", 1);

    if (updErr) throw updErr;

    return res.status(200).json({ ok: true, action: "stopped", idleMinutes });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
