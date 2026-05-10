// api/generate.js
// ─────────────────────────────────────────────────────────────
// CineAI Hybrid Routing System
//
// TEXT ONLY (T2V)
//   → BYTEPLUS SEEDANCE
//
// IMAGE / VIDEO / AUDIO / CONTINUATION
//   → PIAPI SEEDANCE
// ─────────────────────────────────────────────────────────────

import { supabaseAdmin } from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

// ─────────────────────────────────────────────────────────────
// PROVIDERS
// ─────────────────────────────────────────────────────────────

const PIAPI_URL = "https://api.piapi.ai/api/v1/task";
const PIAPI_MODEL = "seedance";
const PIAPI_TASK = "seedance-2-preview";

// Cambia esto por el endpoint oficial que uses en BytePlus
const BYTEPLUS_URL =
  "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

// Cambia el modelo por el correcto si BytePlus usa otro nombre
const BYTEPLUS_MODEL = "seedance-2-0";

// ─────────────────────────────────────────────────────────────
// COSTOS
// ─────────────────────────────────────────────────────────────

const JADE_COSTS = {
  5: 40,
  10: 75,
  15: 110,
};

// ─────────────────────────────────────────────────────────────
// BLOQUEO DE PERSONAJES / CELEBRIDADES
// ─────────────────────────────────────────────────────────────

const BLOCKED_NAMES = [
  "tom cruise",
  "brad pitt",
  "angelina jolie",
  "scarlett johansson",
  "will smith",
  "dwayne johnson",
  "the rock",
  "ryan reynolds",
  "zendaya",
  "bad bunny",
  "taylor swift",
  "beyonce",
  "rihanna",
  "elon musk",
  "donald trump",
  "messi",
  "cristiano ronaldo",
  "spiderman",
  "batman",
  "superman",
  "iron man",
  "thor",
  "hulk",
  "harry potter",
  "disney",
  "marvel",
  "pixar",
  "dc comics",
];

function detectBlockedContent(text) {
  const lower = (text || "").toLowerCase();

  for (const name of BLOCKED_NAMES) {
    const regex = new RegExp(
      `\\b${name.replace(/[-]/g, "\\-")}\\b`,
      "i"
    );

    if (regex.test(lower)) {
      return name;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// PIAPI
// ─────────────────────────────────────────────────────────────

async function submitToPiAPI(payload) {
  console.log("[PIAPI] Sending request...");

  const response = await fetch(PIAPI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.PIAPI_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  console.log("[PIAPI] Response:", JSON.stringify(data));

  if (!response.ok || data.code !== 200) {
    throw new Error(
      data?.error?.message ||
        data?.message ||
        `PiAPI error ${response.status}`
    );
  }

  const taskId = data?.data?.task_id;

  if (!taskId) {
    throw new Error("PiAPI no devolvió task_id");
  }

  return {
    provider: "piapi",
    taskId,
  };
}

// ─────────────────────────────────────────────────────────────
// BYTEPLUS
// ─────────────────────────────────────────────────────────────

async function submitToBytePlus(payload) {
  console.log("[BYTEPLUS] Sending request...");

  const response = await fetch(BYTEPLUS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BYTEPLUS_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  console.log("[BYTEPLUS] Response:", JSON.stringify(data));

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
        data?.message ||
        `BytePlus error ${response.status}`
    );
  }

  const taskId =
    data?.id ||
    data?.task_id ||
    data?.data?.id;

  if (!taskId) {
    throw new Error("BytePlus no devolvió task_id");
  }

  return {
    provider: "byteplus",
    taskId,
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ───────────────────────────────────────────────────────────
  // HEADERS
  // ───────────────────────────────────────────────────────────

  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "content-type, authorization"
  );

  res.setHeader(
    "content-type",
    "application/json; charset=utf-8"
  );

  // ───────────────────────────────────────────────────────────

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
    });
  }

  // ───────────────────────────────────────────────────────────
  // AUTH
  // ───────────────────────────────────────────────────────────

  const userId = await getUserIdFromAuthHeader(req);

  if (!userId) {
    return res.status(401).json({
      ok: false,
      error: "UNAUTHORIZED",
    });
  }

  // ───────────────────────────────────────────────────────────
  // BODY
  // ───────────────────────────────────────────────────────────

  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

  const {
    prompt,
    imageUrl,
    refImages,
    refVideoUrl,
    audioUrl,
    animateExact,
    isContinuation,
    duration = 10,
    aspectRatio = "9:16",
    sceneMode = "tiktok",
  } = body;

  // ───────────────────────────────────────────────────────────
  // VALIDACIONES
  // ───────────────────────────────────────────────────────────

  if (!prompt || String(prompt).trim().length < 5) {
    return res.status(400).json({
      ok: false,
      error: "PROMPT_TOO_SHORT",
    });
  }

  const blocked = detectBlockedContent(prompt);

  if (blocked) {
    return res.status(400).json({
      ok: false,
      error: `"${blocked}" está bloqueado.`,
      blocked: true,
    });
  }

  // ───────────────────────────────────────────────────────────
  // COSTO
  // ───────────────────────────────────────────────────────────

  const jadeCost = JADE_COSTS[duration] || 75;

  const ref =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random()}`;

  // ───────────────────────────────────────────────────────────
  // COBRAR JADES
  // ───────────────────────────────────────────────────────────

  const { error: spendErr } =
    await supabaseAdmin.rpc("spend_jades", {
      p_user_id: userId,
      p_amount: jadeCost,
      p_reason: "cineai_generate",
      p_ref: ref,
    });

  if (spendErr) {
    if (
      (spendErr.message || "").includes(
        "INSUFFICIENT_JADES"
      )
    ) {
      return res.status(402).json({
        ok: false,
        error: "INSUFFICIENT_JADES",
        detail: `Necesitas ${jadeCost} Jades.`,
      });
    }

    return res.status(400).json({
      ok: false,
      error: spendErr.message,
    });
  }

  // ───────────────────────────────────────────────────────────
  // IMÁGENES
  // ───────────────────────────────────────────────────────────

  const allImages = [];

  if (imageUrl) {
    allImages.push(imageUrl);
  }

  if (Array.isArray(refImages)) {
    for (const img of refImages) {
      if (img && !allImages.includes(img)) {
        allImages.push(img);
      }
    }
  }

  const imageList = allImages.slice(0, 6);

  // ───────────────────────────────────────────────────────────
  // DETECTAR PROVIDER
  // ───────────────────────────────────────────────────────────

  const isPureText =
    !imageUrl &&
    !refVideoUrl &&
    !audioUrl &&
    imageList.length === 0;

  const provider = isPureText
    ? "byteplus"
    : "piapi";

  let mode = "t2v";

  console.log("[ROUTING]", {
    provider,
    isPureText,
  });

  // ───────────────────────────────────────────────────────────
  // GENERACIÓN
  // ───────────────────────────────────────────────────────────

  let taskId;
  let finalPrompt = String(prompt).trim();

  try {
    // ========================================================
    // BYTEPLUS — SOLO TEXTO
    // ========================================================

    if (provider === "byteplus") {
      const bytePayload = {
        model: BYTEPLUS_MODEL,

        content: [
          {
            type: "text",
            text: finalPrompt,
          },
        ],

        duration,
        aspect_ratio: aspectRatio,
      };

      const result =
        await submitToBytePlus(bytePayload);

      taskId = result.taskId;
    }

    // ========================================================
    // PIAPI — MULTIMODAL
    // ========================================================

    else {
      const inputExtra = {};

      // ───────────────────────────────────────────────────────
      // CONTINUATION
      // ───────────────────────────────────────────────────────

      if (
        isContinuation &&
        imageList.length > 0 &&
        refVideoUrl
      ) {
        mode = "continuation";

        inputExtra.image_urls = imageList;
        inputExtra.video_urls = [refVideoUrl];

        finalPrompt =
          `Continue this exact scene seamlessly from @Image1. ` +
          `Use @Video1 as full reference. ` +
          finalPrompt;
      }

      // ───────────────────────────────────────────────────────
      // ANIMATE EXACT
      // ───────────────────────────────────────────────────────

      else if (
        animateExact &&
        imageList.length > 0
      ) {
        mode = "animate";

        inputExtra.image_urls = imageList;

        finalPrompt =
          `@Image1 Animate this exact photo naturally. ` +
          `Preserve background and composition. ` +
          finalPrompt;
      }

      // ───────────────────────────────────────────────────────
      // LIPSYNC
      // ───────────────────────────────────────────────────────

      else if (
        audioUrl &&
        imageList.length > 0
      ) {
        mode = "lipsync";

        inputExtra.image_urls = imageList;
        inputExtra.audio_urls = [audioUrl];

        finalPrompt =
          `@Image1 Lip sync perfectly to @Audio1. ` +
          finalPrompt;
      }

      // ───────────────────────────────────────────────────────
      // VIDEO REFERENCE + FACE
      // ───────────────────────────────────────────────────────

      else if (
        refVideoUrl &&
        imageList.length > 0
      ) {
        mode = "r2v+face";

        inputExtra.image_urls = imageList;
        inputExtra.video_urls = [refVideoUrl];

        finalPrompt =
          `Use @Image1 as the main character. ` +
          `Copy ONLY movement from @Video1. ` +
          finalPrompt;
      }

      // ───────────────────────────────────────────────────────
      // IMAGE TO VIDEO
      // ───────────────────────────────────────────────────────

      else if (imageList.length > 0) {
        mode = "i2v";

        inputExtra.image_urls = imageList;

        finalPrompt =
          `@Image1 ${finalPrompt}`;
      }

      // ───────────────────────────────────────────────────────
      // PIAPI PAYLOAD
      // ───────────────────────────────────────────────────────

      const piPayload = {
        model: PIAPI_MODEL,

        task_type: PIAPI_TASK,

        input: {
          prompt: finalPrompt,
          duration,
          aspect_ratio: aspectRatio,
          ...inputExtra,
        },
      };

      const result =
        await submitToPiAPI(piPayload);

      taskId = result.taskId;
    }
  } catch (err) {
    console.error("[GENERATE ERROR]", err);

    // ─────────────────────────────────────────────────────────
    // REEMBOLSO
    // ─────────────────────────────────────────────────────────

    try {
      await supabaseAdmin.rpc("spend_jades", {
        p_user_id: userId,
        p_amount: -jadeCost,
        p_reason: "cineai_refund_error",
        p_ref: ref,
      });
    } catch (refundErr) {
      console.error(
        "[REFUND ERROR]",
        refundErr
      );
    }

    return res.status(500).json({
      ok: false,
      error: err.message,
      refunded: true,
    });
  }

  // ───────────────────────────────────────────────────────────
  // GUARDAR JOB
  // ───────────────────────────────────────────────────────────

  const jobId =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random()}`;

  const { error: insertErr } =
    await supabaseAdmin
      .from("video_jobs")
      .insert({
        id: jobId,

        user_id: userId,

        status: "IN_PROGRESS",

        mode: "cineai",

        provider,

        provider_request_id: taskId,

        provider_status: "pending",

        prompt: finalPrompt,

        started_at: new Date().toISOString(),

        payload: {
          task_id: taskId,

          provider,

          cineai_mode: mode,

          scene_mode: sceneMode,

          duration,

          aspect_ratio: aspectRatio,

          image_url: imageUrl || null,

          ref_images: imageList,

          ref_video_url:
            refVideoUrl || null,

          audio_url: audioUrl || null,

          animate_exact:
            animateExact || false,

          is_continuation:
            isContinuation || false,

          jade_cost: jadeCost,

          ref,
        },
      });

  if (insertErr) {
    console.error(
      "[INSERT ERROR]",
      insertErr.message
    );
  }

  // ───────────────────────────────────────────────────────────
  // SUCCESS
  // ───────────────────────────────────────────────────────────

  console.log("[GENERATE OK]", {
    provider,
    mode,
    taskId,
    jobId,
  });

  return res.status(200).json({
    ok: true,

    provider,

    mode,

    taskId,

    jobId,

    jadeCost,
  });
}

export const config = {
  runtime: "nodejs",
};
