// /api/generate.js
// ============================================================
// IsabelaOS Studio - Imagen desde Prompt
// - Valida usuario (Bearer token) usando requireUser()
// - Cobra jades (RPC spend_jades) ANTES de generar
// - (NUEVO) Registra/Incrementa uso diario en public.daily_usage (free_images_used)
// - Lanza el job a RunPod (endpoint /run) y devuelve jobId
// - Runtime: EDGE
//
// IMPORTANTE:
// - Este archivo debe estar en /api/generate.js (RAÍZ DEL REPO)
// ============================================================

import { requireUser } from "./_auth.js";

const COST_IMG_PROMPT_JADES = 1; // <- AJUSTA AQUÍ

// ============================================================
// DAILY USAGE (coincide con tu tabla public.daily_usage)
// ============================================================
const DAILY_USAGE_TABLE = "daily_usage";
const USER_ID_COL = "user_id";
const DAY_COL = "day";
const COUNT_COL = "free_images_used";

function ymdUTC() {
  // guardamos el "día" consistente (UTC) como YYYY-MM-DD para col "date"
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: cors,
    });
  }

  try {
    console.log("[GEN] step=START");

    const body = await req.json().catch(() => null);

    if (!body || !body.prompt) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_PROMPT" }), {
        status: 400,
        headers: cors,
      });
    }

    // 1) AUTH
    console.log("[GEN] step=AUTH_BEGIN");
    const auth = await requireUser(req);

    if (!auth.ok) {
      console.log("[GEN] step=AUTH_FAIL", auth.error);
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.code || 401,
        headers: cors,
      });
    }

    const user_id = auth.user.id; // UUID string
    console.log("[GEN] step=AUTH_OK user_id=", user_id);

    // 2) COBRO (RPC spend_jades)
    console.log("[GEN] step=JADE_CHARGE_BEGIN");

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.log("[GEN] step=MISSING_ENV_SUPABASE");
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_ENV",
          detail: "Falta SUPABASE_URL (o VITE_SUPABASE_URL) o SUPABASE_SERVICE_ROLE_KEY en Vercel.",
        }),
        { status: 500, headers: cors }
      );
    }

    const baseRest = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
    const rpcUrl = `${baseRest}/rpc/spend_jades`;

    // p_ref en tu función es TEXT, así que mandamos string o null
    const ref = body.ref == null ? null : String(body.ref);

    const spendRes = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_user_id: user_id, // UUID string -> OK
        p_amount: COST_IMG_PROMPT_JADES, // int
        p_reason: "generation:img_prompt", // text
        p_ref: ref, // text | null
      }),
    });

    if (!spendRes.ok) {
      const spendTxt = await spendRes.text();
      console.log("[GEN] step=JADE_CHARGE_FAIL", spendRes.status, spendTxt);

      if ((spendTxt || "").includes("INSUFFICIENT_JADES")) {
        return new Response(JSON.stringify({ ok: false, error: "INSUFFICIENT_JADES" }), {
          status: 402,
          headers: cors,
        });
      }

      return new Response(
        JSON.stringify({ ok: false, error: "RPC_SPEND_JADES_ERROR", details: spendTxt }),
        { status: 500, headers: cors }
      );
    }

    console.log("[GEN] step=JADE_CHARGE_OK");

    // 2.5) DAILY USAGE (UPsert + increment)
    // Nota: Esto NO aplica el límite aquí (porque tu límite lo manejas en front-end),
    // pero sirve para registrar uso real y que tu getTodayGenerationCount tenga datos.
    try {
      console.log("[GEN] step=DAILY_USAGE_BEGIN");

      const today = ymdUTC();

      // ✅ tu requerimiento exacto:
      const upsertUrl = `${baseRest}/${DAILY_USAGE_TABLE}?on_conflict=${USER_ID_COL},${DAY_COL}`;

      // 1) leemos el registro de hoy para obtener count actual
      const selUrl =
        `${baseRest}/${DAILY_USAGE_TABLE}` +
        `?select=${COUNT_COL}` +
        `&${USER_ID_COL}=eq.${encodeURIComponent(user_id)}` +
        `&${DAY_COL}=eq.${encodeURIComponent(today)}` +
        `&limit=1`;

      const selRes = await fetch(selUrl, {
        method: "GET",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });

      let current = 0;
      if (selRes.ok) {
        const rows = await selRes.json().catch(() => []);
        current = Number(rows?.[0]?.[COUNT_COL] ?? 0) || 0;
      } else {
        const t = await selRes.text().catch(() => "");
        console.log("[GEN] step=DAILY_USAGE_SELECT_WARN", selRes.status, t);
      }

      const next = current + 1;

      // 2) upsert con el nuevo conteo
      const upRes = await fetch(upsertUrl, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify([
          {
            [USER_ID_COL]: user_id,
            [DAY_COL]: today,
            [COUNT_COL]: next,
          },
        ]),
      });

      if (!upRes.ok) {
        const upTxt = await upRes.text().catch(() => "");
        console.log("[GEN] step=DAILY_USAGE_UPSERT_WARN", upRes.status, upTxt);
      } else {
        console.log("[GEN] step=DAILY_USAGE_OK", { today, prev: current, next });
      }
    } catch (e) {
      console.log("[GEN] step=DAILY_USAGE_CRASH_WARN", String(e));
      // No rompemos el flujo por esto
    }

    // 3) RUNPOD
    console.log("[GEN] step=RUNPOD_BEGIN");

    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const rpKey = process.env.RP_API_KEY || process.env.RUNPOD_API_KEY;

    if (!rpKey || !endpointId) {
      console.log("[GEN] step=MISSING_RP_ENV");
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_RP_ENV",
          detail: "Falta RP_API_KEY (o RUNPOD_API_KEY) y endpointId (RUNPOD_ENDPOINT_ID / RP_ENDPOINT).",
        }),
        { status: 500, headers: cors }
      );
    }

    const base = `https://api.runpod.ai/v2/${endpointId}`;

    const rp = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rpKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          prompt: body.prompt,
          negative_prompt: body.negative_prompt || "",
          width: body.width || 512,
          height: body.height || 512,
          steps: body.steps || 22,
          user_id, // SIEMPRE desde auth
        },
      }),
    });

    if (!rp.ok) {
      const txt = await rp.text();
      console.log("[GEN] step=RUNPOD_RUN_ERROR", rp.status, txt);
      return new Response(JSON.stringify({ ok: false, error: "RUNPOD_RUN_ERROR", details: txt }), {
        status: rp.status,
        headers: cors,
      });
    }

    const data = await rp.json();
    const jobId = data.id || data.requestId || data.jobId || data.data?.id;

    if (!jobId) {
      console.log("[GEN] step=RUNPOD_NO_ID raw=", data);
      return new Response(JSON.stringify({ ok: false, error: "RUNPOD_NO_ID", raw: data }), {
        status: 500,
        headers: cors,
      });
    }

    console.log("[GEN] step=OK jobId=", jobId);

    return new Response(
      JSON.stringify({
        ok: true,
        jobId,
        billed: { type: "JADE", amount: COST_IMG_PROMPT_JADES },
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    console.error("[GEN] step=CRASH", e);
    return new Response(JSON.stringify({ ok: false, error: "SERVER_ERROR", details: String(e) }), {
      status: 500,
      headers: cors,
    });
  }
}

export const config = { runtime: "edge" };