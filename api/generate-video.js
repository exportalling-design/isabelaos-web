// api/generate-video.js
export const runtime = "nodejs";

// ---------------------------------------------------------
// Generate Video (dispatch inmediato a RunPod Serverless)
// - Inserta video_jobs en QUEUED
// - Valida limite de concurrencia (VIDEO_MAX_ACTIVE)
// - Llama a RunPod /run
// - Actualiza job a RUNNING + provider_request_id
// ---------------------------------------------------------

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ✅ Ajusta el import a TU auth real (no invento /var/task/pages)
// Si ya tienes getAuthHeadersGlobal en frontend, aquí validamos JWT desde Authorization
async function requireUser(req, supabaseAdmin) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { ok: false, status: 401, error: "Missing Bearer token" };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) {
    return { ok: false, status: 401, error: "Invalid token" };
  }
  return { ok: true, user: data.user };
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function nowISO() {
  return new Date().toISOString();
}

// RunPod serverless:
// POST https://api.runpod.ai/v2/{ENDPOINT_ID}/run
// GET  https://api.runpod.ai/v2/{ENDPOINT_ID}/status/{REQUEST_ID}
async function runpodRun({ endpointId, apiKey, input }) {
  const url = `https://api.runpod.ai/v2/${endpointId}/run`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input }),
  });

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(data?.error || data?.message || `RunPod /run failed (${r.status})`);
  }
  // Normalmente devuelve { id: "xxxx", status: "IN_QUEUE" ... }
  if (!data?.id) throw new Error("RunPod /run: missing id");
  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

    // ---- ENV ----
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    const VIDEO_RUNPOD_ENDPOINT_ID = process.env.VIDEO_RUNPOD_ENDPOINT_ID; // <- endpoint serverless id
    const VIDEO_MAX_ACTIVE = parseInt(process.env.VIDEO_MAX_ACTIVE || "1", 10);

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { ok: false, error: "Missing Supabase env" });
    }
    if (!RUNPOD_API_KEY || !VIDEO_RUNPOD_ENDPOINT_ID) {
      return json(res, 500, { ok: false, error: "Missing RunPod env" });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ---- AUTH ----
    const au = await requireUser(req, supabaseAdmin);
    if (!au.ok) return json(res, au.status, { ok: false, error: au.error });
    const user = au.user;

    // ---- BODY ----
    const body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });

    const prompt = (body.prompt || "").trim();
    const negative_prompt = (body.negative || "").trim();

    const duration_s = Number(body.duration_s || body.duration || 3);
    const fps = Number(body.fps || 24);
    const steps = Number(body.steps || 18);
    const guidance_scale = Number(body.guidance_scale || body.guidance || 5);

    const aspect_ratio = body.aspect_ratio || (body.isVertical ? "9:16" : "1:1");
    const mode = body.mode || "t2v"; // text-to-video (tu worker ya acepta "t2v")

    if (!prompt) return json(res, 400, { ok: false, error: "Missing prompt" });

    // ---- Limite de concurrencia (global por usuario) ----
    // Cuenta RUNNING recientes para evitar jobs pegados eternos:
    // si quieres, sube/baja ventana a 30 min
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: activeRows, error: activeErr } = await supabaseAdmin
      .from("video_jobs")
      .select("id", { count: "exact", head: false })
      .eq("user_id", user.id)
      .eq("status", "RUNNING")
      .gte("updated_at", thirtyMinAgo);

    if (activeErr) throw activeErr;

    const activeCount = Array.isArray(activeRows) ? activeRows.length : 0;
    if (activeCount >= VIDEO_MAX_ACTIVE) {
      return json(res, 429, {
        ok: false,
        error: `Too many active videos (${activeCount}/${VIDEO_MAX_ACTIVE}). Wait for completion.`,
      });
    }

    // ---- Insert job (QUEUED) ----
    const slotToken = crypto.randomBytes(16).toString("hex");

    const insertPayload = {
      user_id: user.id,
      status: "QUEUED",
      provider: "runpod",
      provider_status: null,
      provider_request_id: null,
      progress: 0,
      result_url: null,
      error: null,
      // campos slot (si existen en tu tabla)
      slot_reserved: true, // A: reservamos de una vez (para no quedar colgado)
      slot_token: slotToken,
      started_at: null,
      updated_at: nowISO(),
      created_at: nowISO(),
      // params útiles para debugging (si tu tabla tiene columnas json)
      params: {
        mode,
        prompt,
        negative_prompt,
        duration_s,
        fps,
        steps,
        guidance_scale,
        aspect_ratio,
      },
    };

    const { data: jobRow, error: insErr } = await supabaseAdmin
      .from("video_jobs")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insErr) throw insErr;

    // ---- Dispatch inmediato a RunPod ----
    const runInput = {
      mode,
      prompt,
      negative_prompt,
      steps,
      guidance_scale,
      duration_s,
      fps,
      aspect_ratio,
      // opcionales:
      job_id: jobRow.id,
      user_id: user.id,
      slot_token: slotToken,
    };

    let runpodResp;
    try {
      runpodResp = await runpodRun({
        endpointId: VIDEO_RUNPOD_ENDPOINT_ID,
        apiKey: RUNPOD_API_KEY,
        input: runInput,
      });
    } catch (e) {
      // Si falla el dispatch, marca FAILED y libera slot
      await supabaseAdmin
        .from("video_jobs")
        .update({
          status: "FAILED",
          provider_status: "DISPATCH_FAILED",
          error: String(e?.message || e),
          slot_reserved: false,
          slot_token: null,
          updated_at: nowISO(),
        })
        .eq("id", jobRow.id);

      return json(res, 500, { ok: false, error: `Dispatch failed: ${String(e?.message || e)}` });
    }

    // ---- Update job a RUNNING ----
    const { data: updRow, error: updErr } = await supabaseAdmin
      .from("video_jobs")
      .update({
        status: "RUNNING",
        provider_status: runpodResp.status || "IN_QUEUE",
        provider_request_id: runpodResp.id,
        started_at: nowISO(),
        progress: 1,
        updated_at: nowISO(),
      })
      .eq("id", jobRow.id)
      .select("*")
      .single();

    if (updErr) throw updErr;

    return json(res, 200, {
      ok: true,
      job_id: updRow.id,
      provider_request_id: updRow.provider_request_id,
      provider_status: updRow.provider_status,
      status: updRow.status,
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
