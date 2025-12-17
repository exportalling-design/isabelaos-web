// /api/generate-video.js
// ============================================================
// IsabelaOS Studio - Video Generate API (Vercel Serverless)
//
// MODO B (CORRECTO):
// - Cada request crea UN POD NUEVO vía API (GraphQL)
// - El pod usa TEMPLATE + VOLUMEN persistente
// - start.sh levanta el worker automáticamente
// - NO se reusa pod_id
// - NO se guarda endpoint fijo
// ============================================================

import { createClient } from "@supabase/supabase-js";

// ============================================================
// ENV (Vercel)
// ============================================================
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// RunPod
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

// ⚠️ ID DEL VOLUMEN PERSISTENTE (EL QUE YA CREASTE)
const RUNPOD_VOLUME_ID = "x4ppgiwpse";

// Región / GPU (ajusta si cambias)
const RUNPOD_GPU_TYPE = "NVIDIA_A6000";

// Imagen base (igual a tu template)
const RUNPOD_IMAGE =
  "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04";

// ============================================================
// Supabase helpers
// ============================================================
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// RunPod: CREATE POD (GraphQL)
// ============================================================
async function createVideoPod() {
  const query = `
    mutation CreatePod($input: CreatePodInput!) {
      createPod(input: $input) {
        id
        name
      }
    }
  `;

  const variables = {
    input: {
      name: "isabela-video-auto",
      imageName: RUNPOD_IMAGE,
      gpuTypeId: RUNPOD_GPU_TYPE,
      cloudType: "SECURE",

      // 🔥 VOLUMEN PERSISTENTE
      volumeId: RUNPOD_VOLUME_ID,
      volumeMountPath: "/workspace",

      // Puertos
      ports: "8000/http,8888/http",

      // start.sh ARRANCA SOLO
      dockerStartCmd: "bash -lc '/workspace/start.sh'",
    },
  };

  const r = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await r.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }

  return json.data.createPod.id;
}

// ============================================================
// Esperar POD → RUNNING
// ============================================================
async function waitForPodRunning(podId, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const r = await fetch(
      `https://rest.runpod.io/v1/pods/${podId}`,
      {
        headers: {
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
      }
    );

    const pod = await r.json();
    if ((pod?.status || "").toUpperCase() === "RUNNING") {
      return;
    }

    await sleep(3000);
  }

  throw new Error("Timeout esperando pod RUNNING");
}

// ============================================================
// Esperar WORKER (puerto 8000)
// ============================================================
async function waitForWorkerReady(endpoint, timeoutMs = 5 * 60 * 1000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${endpoint}/api/video`, {
        method: "GET",
      });

      // 405 = existe endpoint (POST only)
      if (r.ok || r.status === 405) return;
    } catch (_) {}

    await sleep(2500);
  }

  throw new Error("Worker no respondió en /api/video");
}

// ============================================================
// API HANDLER
// ============================================================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const sb = sbAdmin();

    // ========================================================
    // 1) CREAR POD NUEVO (OPCIÓN B)
    // ========================================================
    const podId = await createVideoPod();

    // ========================================================
    // 2) ESPERAR A QUE EL POD ESTÉ RUNNING
    // ========================================================
    await waitForPodRunning(podId);

    // ========================================================
    // 3) CONSTRUIR ENDPOINT DINÁMICO
    // ========================================================
    const workerEndpoint = `https://${podId}-8000.proxy.runpod.net`;

    // ========================================================
    // 4) ESPERAR A QUE EL WORKER LEVANTE
    // ========================================================
    await waitForWorkerReady(workerEndpoint);

    // ========================================================
    // 5) PROXY AL WORKER
    // ========================================================
    const r = await fetch(`${workerEndpoint}/api/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const data = await r.json();

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e),
    });
  }
}
