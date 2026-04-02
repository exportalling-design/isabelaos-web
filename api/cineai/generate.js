// api/cineai/generate.js
// ─────────────────────────────────────────────────────────────
// Endpoint de generación de video con Seedance 2.0 via PiAPI
//
// Modos:
//   t2v        → solo texto → video
//   i2v        → foto del usuario → video animado
//   r2v        → video de referencia → copia el movimiento
//   r2v+face   → video referencia + foto → movimiento con cara del usuario
//   animate    → foto exacta animada sin cambiar escenario ni personajes
//
// Guarda en tabla video_jobs (misma que generate-img2video)
// con mode: "cineai" para que aparezca en la biblioteca.
//
// Imports: mismo patrón que api/generate.js y api/generate-img2video.js
// ─────────────────────────────────────────────────────────────
import { supabaseAdmin }           from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader }  from "../../src/lib/getUserIdFromAuth.js";

const PIAPI_URL = "https://api.piapi.ai/api/v1/task";

// ── Costo en Jades por duración ───────────────────────────────
const JADE_COSTS = {
  5:  40,
  10: 75,
  15: 110,
};

// ── Lista de celebridades y personajes bloqueados ─────────────
// Se valida aquí en backend. El frontend también lo muestra en UI.
const BLOCKED_NAMES = [
  // Actores
  "tom cruise","brad pitt","angelina jolie","scarlett johansson",
  "will smith","dwayne johnson","the rock","ryan reynolds",
  "chris evans","chris hemsworth","robert downey","zendaya",
  // Músicos LATAM y globales
  "bad bunny","benito martinez","j balvin","ozuna","daddy yankee",
  "maluma","shakira","jennifer lopez","j.lo","taylor swift",
  "beyoncé","beyonce","rihanna","drake","nicki minaj","cardi b",
  "ariana grande","billie eilish","harry styles","ed sheeran",
  "justin bieber","selena gomez",
  // Figuras públicas
  "elon musk","jeff bezos","mark zuckerberg","donald trump",
  "joe biden","obama","kim kardashian","kanye west","ye",
  // Deportistas
  "messi","cristiano ronaldo","ronaldo","neymar",
  "lebron james","michael jordan","kobe bryant",
  // Personajes con copyright
  "spider-man","spiderman","batman","superman","iron man","ironman",
  "thor","hulk","captain america","black widow","darth vader",
  "grogu","baby yoda","yoda","luke skywalker","han solo",
  "shrek","sonic","pikachu","mario","mickey mouse",
  "spongebob","esponja","patrick star","bugs bunny",
  "harry potter","hermione","voldemort","gandalf","frodo",
  "james bond","jack sparrow","indiana jones",
  "optimus prime","megatron","godzilla","king kong",
  "bruce lee","brucelle","bruce willis","jackie chan",
  // Marcas / estudios
  "disney","marvel","pixar","warner","dc comics","netflix",
];

// Retorna el nombre bloqueado encontrado, o null si está limpio
function detectBlockedContent(text) {
  const lower = (text || "").toLowerCase();
  for (const name of BLOCKED_NAMES) {
    if (lower.includes(name)) return name;
  }
  return null;
}

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  // ── Auth ──────────────────────────────────────────────────
  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  // ── Leer body ─────────────────────────────────────────────
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

  const {
    prompt,        // descripción de la escena (requerido)
    imageUrl,      // URL pública foto del usuario en Supabase Storage (opcional)
    refVideoUrl,   // URL pública video de referencia para copiar movimiento (opcional)
    animateExact,  // boolean: animar foto exacta sin cambiar escenario (opcional)
    duration = 10, // 5 | 10 | 15
    aspectRatio = "9:16",
    sceneMode = "tiktok", // "tiktok" | "cine" — para logging
  } = body;

  // ── Validación básica ─────────────────────────────────────
  if (!prompt || String(prompt).trim().length < 5) {
    return res.status(400).json({ ok: false, error: "El prompt es muy corto" });
  }

  // ── Bloqueo de celebridades / IP ──────────────────────────
  const blocked = detectBlockedContent(prompt);
  if (blocked) {
    return res.status(400).json({
      ok: false,
      error: `"${blocked}" está bloqueado por derechos de autor. Describe un personaje original.`,
      blocked: true,
    });
  }

  // ── Costo en Jades ────────────────────────────────────────
  const jadeCost = JADE_COSTS[duration] || 75;

  // ── Descontar Jades ANTES de llamar a PiAPI ───────────────
  const ref = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

  const { error: spendErr } = await supabaseAdmin.rpc("spend_jades", {
    p_user_id: userId,
    p_amount:  jadeCost,
    p_reason:  "cineai_generate",
    p_ref:     ref,
  });

  if (spendErr) {
    console.error("[cineai/generate] spend_jades failed:", spendErr.message);
    if ((spendErr.message || "").includes("INSUFFICIENT_JADES")) {
      return res.status(402).json({
        ok: false,
        error: "INSUFFICIENT_JADES",
        detail: `Necesitas ${jadeCost} Jades para esta generación.`,
        required: jadeCost,
      });
    }
    return res.status(400).json({ ok: false, error: spendErr.message });
  }

  // ── Construir prompt y payload para PiAPI / Seedance 2.0 ──
  // Modos:
  //   animateExact = true  → I2V puro, prompt minimal para no cambiar escena
  //   refVideoUrl + imageUrl → R2V+face: copia movimiento con cara del usuario
  //   refVideoUrl solo       → R2V: copia movimiento, personaje genérico
  //   imageUrl solo          → I2V: animar foto
  //   ninguno                → T2V: solo texto

  let finalPrompt = String(prompt).trim();
  const inputExtra = {};
  let mode = "t2v";

  if (animateExact && imageUrl) {
    // Modo "Animar foto exacta" — mantiene escenario y personajes originales
    inputExtra.image_urls = [imageUrl];
    finalPrompt = `Animate this exact scene naturally. Keep all characters, background, and composition exactly as shown. ${finalPrompt}`;
    mode = "animate";
  } else if (refVideoUrl) {
    inputExtra.video_urls = [refVideoUrl];
    if (imageUrl) {
      inputExtra.image_urls = [imageUrl];
      finalPrompt = `Keep the exact motion and choreography from @Video1. Replace the subject with the person in @Image1. ${finalPrompt}`;
      mode = "r2v+face";
    } else {
      finalPrompt = `Keep the exact motion and choreography from @Video1. ${finalPrompt}`;
      mode = "r2v";
    }
  } else if (imageUrl) {
    inputExtra.image_urls = [imageUrl];
    mode = "i2v";
  }

  const piPayload = {
    model: "seedance",
    task_type: "seedance-2-preview",
    input: {
      prompt: finalPrompt,
      duration,
      aspect_ratio: aspectRatio,
      ...inputExtra,
    },
  };

  // ── Llamar a PiAPI ────────────────────────────────────────
  let piTask;
  try {
    const piRes = await fetch(PIAPI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PIAPI_KEY,
      },
      body: JSON.stringify(piPayload),
    });

    piTask = await piRes.json();

    if (!piRes.ok || piTask.code !== 200) {
      throw new Error(piTask.message || "PiAPI error");
    }
  } catch (err) {
    // PiAPI falló → reembolsar Jades
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount:  -jadeCost,
      p_reason:  "cineai_refund_piapi_error",
      p_ref:     ref,
    });
    console.error("[cineai/generate] PiAPI error:", err.message);
    return res.status(500).json({ ok: false, error: "Error generando video. Jades reembolsados." });
  }

  const taskId = piTask.data?.task_id;

  // ── Guardar en video_jobs (misma tabla que el resto) ──────
  // mode: "cineai" para que la biblioteca lo pueda filtrar
  const jobId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

  await supabaseAdmin.from("video_jobs").insert({
    id:          jobId,
    user_id:     userId,
    status:      "IN_PROGRESS",
    mode:        "cineai",
    prompt:      finalPrompt,
    provider:    "piapi_seedance",
    payload: {
      task_id:      taskId,
      cineai_mode:  mode,
      scene_mode:   sceneMode,
      duration,
      aspect_ratio: aspectRatio,
      image_url:    imageUrl    || null,
      ref_video_url: refVideoUrl || null,
      animate_exact: animateExact || false,
      jade_cost:    jadeCost,
      ref,
    },
    provider_request_id: taskId,
    provider_status:     "pending",
    started_at:          new Date().toISOString(),
  });

  return res.status(200).json({
    ok:       true,
    jobId,          // ID interno en video_jobs
    taskId,         // ID de PiAPI para hacer polling
    mode,
    jadeCost,
  });
}

export const config = { runtime: "nodejs" };
