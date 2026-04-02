// ─────────────────────────────────────────────────────────────────────────────
// api/cineai/generate.js
// POST /api/cineai/generate
//
// Genera un video con Seedance 2.0 via PiAPI.
// Soporta 3 modos:
//   t2v        → solo texto
//   i2v        → foto del usuario → video animado
//   r2v        → video de referencia → copia el movimiento
//   r2v+face   → video de referencia + foto → copia movimiento con cara del usuario
//
// Rutas de archivos en tu proyecto:
//   api/cineai/generate.js   (Next.js: pages/api/cineai/generate.js)
//   Vercel serverless:       api/cineai/generate.js
// ─────────────────────────────────────────────────────────────────────────────

import { requireUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const PIAPI_KEY = process.env.PIAPI_KEY;
const PIAPI_URL = "https://api.piapi.ai/api/v1/task";

// ── Costo en Jades por duración ───────────────────────────────────────────────
const JADE_COSTS = {
  5: 40,
  10: 75,
  15: 110,
};

// ── Lista de nombres bloqueados (celebridades + IP con copyright) ─────────────
// Se revisa tanto en el backend (aquí) como en el frontend (CineAIPanel.jsx).
// Si el prompt contiene alguno de estos nombres, se rechaza SIN cobrar Jades.
const BLOCKED_NAMES = [
  // Actores
  "tom cruise", "brad pitt", "angelina jolie", "scarlett johansson",
  "will smith", "dwayne johnson", "the rock", "ryan reynolds",
  "chris evans", "chris hemsworth", "robert downey", "zendaya",
  // Músicos LATAM y globales
  "bad bunny", "benito martinez", "j balvin", "ozuna", "daddy yankee",
  "maluma", "shakira", "jennifer lopez", "j.lo", "taylor swift",
  "beyoncé", "beyonce", "rihanna", "drake", "nicki minaj", "cardi b",
  "ariana grande", "billie eilish", "harry styles", "ed sheeran",
  "justin bieber", "selena gomez",
  // Figuras públicas
  "elon musk", "jeff bezos", "mark zuckerberg", "donald trump",
  "joe biden", "obama", "kim kardashian", "kanye west", "ye",
  // Deportistas
  "messi", "cristiano ronaldo", "ronaldo", "neymar",
  "lebron james", "michael jordan", "kobe bryant",
  // Personajes con copyright de estudios
  "spider-man", "spiderman", "batman", "superman", "iron man", "ironman",
  "thor", "hulk", "captain america", "black widow", "darth vader",
  "grogu", "baby yoda", "yoda", "luke skywalker", "han solo",
  "shrek", "sonic", "pikachu", "mario", "mickey mouse",
  "spongebob", "esponja", "patrick star", "bugs bunny",
  "harry potter", "hermione", "voldemort", "gandalf", "frodo",
  "james bond", "jack sparrow", "indiana jones",
  "optimus prime", "megatron", "godzilla", "king kong",
  // Marcas / estudios
  "disney", "marvel", "pixar", "warner", "dc comics", "netflix",
];

// Revisa si el texto contiene algún nombre bloqueado.
// Retorna el nombre encontrado o null si está limpio.
function detectBlockedContent(text) {
  const lower = text.toLowerCase();
  for (const name of BLOCKED_NAMES) {
    if (lower.includes(name)) return name;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // ── Auth ─────────────────────────────────────────────────────────────────
  let user;
  try {
    user = await requireUser(req);
  } catch {
    return res.status(401).json({ error: "No autorizado" });
  }

  const {
    prompt,        // descripción de la escena (requerido)
    imageUrl,      // URL pública de la foto del usuario en Supabase Storage (opcional)
    refVideoUrl,   // URL pública del video de referencia para copiar movimiento (opcional)
    duration = 10, // duración en segundos: 5 | 10 | 15
    aspectRatio = "9:16", // formato: 9:16 | 16:9 | 1:1
  } = req.body;

  // ── Validación básica ─────────────────────────────────────────────────────
  if (!prompt || prompt.trim().length < 5) {
    return res.status(400).json({ error: "El prompt es muy corto" });
  }

  // ── Chequeo de celebridades / IP ──────────────────────────────────────────
  const blocked = detectBlockedContent(prompt);
  if (blocked) {
    return res.status(400).json({
      error: `No está permitido usar "${blocked}". Describe un personaje original.`,
      blocked: true,
    });
  }

  // ── Costo en Jades ────────────────────────────────────────────────────────
  const jadeCost = JADE_COSTS[duration] || 75;
  const sb = getSupabaseAdmin();

  // Descontar Jades ANTES de llamar al API
  const { error: spendError } = await sb.rpc("spend_jades", {
    p_user_id: user.id,
    p_amount: jadeCost,
    p_description: `CineAI - video ${duration}s`,
  });
  if (spendError) {
    return res.status(402).json({ error: "Jades insuficientes" });
  }

  // ── Construir payload para PiAPI / Seedance 2.0 ───────────────────────────
  // Modo R2V (Reference-to-Video): se usa cuando hay video de referencia.
  // Seedance usa sintaxis @Video1 y @Image1 en el prompt para mapear referencias.
  let finalPrompt = prompt.trim();
  const inputExtra = {};

  if (refVideoUrl) {
    // Modo R2V: copiar movimiento del video de referencia
    inputExtra.video_urls = [refVideoUrl];

    if (imageUrl) {
      // Modo R2V + Face: copiar movimiento Y poner cara del usuario
      inputExtra.image_urls = [imageUrl];
      finalPrompt = `Keep the exact motion and choreography from @Video1. Replace the subject with the person in @Image1. ${finalPrompt}`;
    } else {
      // Modo R2V sin cara: solo copia el movimiento
      finalPrompt = `Keep the exact motion and choreography from @Video1. ${finalPrompt}`;
    }
  } else if (imageUrl) {
    // Modo I2V: animar la foto del usuario
    inputExtra.image_urls = [imageUrl];
  }
  // Si no hay ninguna imagen ni video → Modo T2V puro

  const payload = {
    model: "seedance",
    task_type: "seedance-2-preview",
    input: {
      prompt: finalPrompt,
      duration,
      aspect_ratio: aspectRatio,
      ...inputExtra,
    },
  };

  // ── Llamar a PiAPI ────────────────────────────────────────────────────────
  let piTask;
  try {
    const response = await fetch(PIAPI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": PIAPI_KEY,
      },
      body: JSON.stringify(payload),
    });

    piTask = await response.json();

    if (!response.ok || piTask.code !== 200) {
      throw new Error(piTask.message || "PiAPI error");
    }
  } catch (err) {
    // Si PiAPI falla → reembolsar Jades
    await sb.rpc("spend_jades", {
      p_user_id: user.id,
      p_amount: -jadeCost,
      p_description: "CineAI - reembolso por error",
    });
    console.error("[CineAI generate] PiAPI error:", err.message);
    return res.status(500).json({ error: "Error generando video" });
  }

  const taskId = piTask.data?.task_id;

  // Determinar modo para logging
  const mode = refVideoUrl
    ? imageUrl ? "r2v+face" : "r2v"
    : imageUrl ? "i2v" : "t2v";

  // ── Guardar job en Supabase ───────────────────────────────────────────────
  await sb.from("cineai_jobs").insert({
    user_id: user.id,
    task_id: taskId,
    prompt: finalPrompt,
    image_url: imageUrl || null,
    ref_video_url: refVideoUrl || null,
    mode,
    duration,
    aspect_ratio: aspectRatio,
    jade_cost: jadeCost,
    status: "pending",
    provider: "piapi",
    // provider: "falai" cuando fal.ai lance Seedance 2.0 — solo cambiar aquí
  });

  return res.status(200).json({ taskId, status: "pending", mode });
}
