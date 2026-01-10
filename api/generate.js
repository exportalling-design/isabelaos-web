// /api/generate.js
// ============================================================
// IsabelaOS Studio - Imagen desde Prompt (RunPod)
// ✅ Reglas pedidas:
//
// 1) Usuarios NUEVOS / plan "free":
//    - Tienen 5 imágenes GRATIS por día aunque jade_balance = 0
//    - Se registra el conteo en public.daily_usage (free_images_used)
//
// 2) Usuarios BASIC / PRO (o cualquier plan != free):
//    - NO existe “5 gratis”
//    - SOLO se descuentan jades por cada render (hasta que se acaben)
//
// 3) Si plan "free" ya usó sus 5 gratis:
//    - A partir de ahí, SOLO puede generar si tiene jades (se cobra spend_jades)
//
// IMPORTANTE:
// - Lee el plan desde public.profiles.plan (fuente de verdad para UI)
// - Usa RPC spend_jades SOLO cuando corresponde (plan pagado o free sin freebies)
// - Actualiza daily_usage SOLO cuando fue una generación gratis.
//
// EDGE runtime
// - Este archivo debe estar en /api/generate.js (RAÍZ DEL REPO)
// ============================================================

import { requireUser } from "./_auth.js";

const COST_IMG_PROMPT_JADES = 1; // <- AJUSTA AQUÍ
const FREE_DAILY_LIMIT = 5;

// ✅ Tabla de uso diario (como pediste)
const DAILY_USAGE_TABLE = "daily_usage";
const USER_ID_COL = "user_id";
const DAY_COL = "day";
const COUNT_COL = "free_images_used";

function todayISODateUTC() {
  // "YYYY-MM-DD" en UTC (consistente para backend)
  return new Date().toISOString().slice(0, 10);
}

function normalizePlan(p) {
  const s = String(p || "").trim().toLowerCase();
  if (!s) return "free";
  return s;
}

function isFreePlan(plan) {
  const p = normalizePlan(plan);
  return p === "free" || p === "none";
}

async function readJsonSafe(res) {
  return await res.json().catch(() => null);
}

export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

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

    // 2) ENV supabase
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.log("[GEN] step=MISSING_ENV_SUPABASE");
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_ENV",
          detail:
            "Falta SUPABASE_URL (o VITE_SUPABASE_URL) o SUPABASE_SERVICE_ROLE_KEY en Vercel.",
        }),
        { status: 500, headers: cors }
      );
    }

    const baseRest = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;

    const sbHeaders = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // 3) Leer plan desde profiles (fuente de verdad)
    console.log("[GEN] step=PLAN_READ_BEGIN");

    const profileUrl = `${baseRest}/profiles?select=plan&id=eq.${encodeURIComponent(user_id)}`;
    const profileRes = await fetch(profileUrl, {
      method: "GET",
      headers: {
        ...sbHeaders,
        // devuelve objeto único si existe
        Accept: "application/vnd.pgrst.object+json",
      },
    });

    let plan = "free";
    if (profileRes.ok) {
      const profile = await readJsonSafe(profileRes);
      plan = normalizePlan(profile?.plan);
    } else {
      // Si no existe profile, lo tratamos como free (usuario nuevo)
      plan = "free";
    }

    const freeUser = isFreePlan(plan);

    console.log("[GEN] step=PLAN_READ_OK", { plan, freeUser });

    // 4) Lógica de 5 gratis SOLO para free
    const today = todayISODateUTC();
    let usedFreeToday = 0;
    let allowFreeGeneration = false;

    if (freeUser) {
      console.log("[GEN] step=DAILY_USAGE_READ_BEGIN", { day: today });

      const readUsageUrl = `${baseRest}/${DAILY_USAGE_TABLE}?select=${COUNT_COL}&${USER_ID_COL}=eq.${encodeURIComponent(
        user_id
      )}&${DAY_COL}=eq.${encodeURIComponent(today)}`;

      const usageRes = await fetch(readUsageUrl, {
        method: "GET",
        headers: {
          ...sbHeaders,
          Accept: "application/vnd.pgrst.object+json",
        },
      });

      if (usageRes.ok) {
        const usageRow = await readJsonSafe(usageRes);
        usedFreeToday = Number(usageRow?.[COUNT_COL] || 0);
      } else {
        // si no hay fila todavía, se queda 0
        usedFreeToday = 0;
      }

      allowFreeGeneration = usedFreeToday < FREE_DAILY_LIMIT;

      console.log("[GEN] step=DAILY_USAGE_READ_OK", {
        usedFreeToday,
        allowFreeGeneration,
      });

      // Si todavía tiene freebies, incrementamos contador ANTES de generar
      // (para reservar el cupo y evitar “doble click”)
      if (allowFreeGeneration) {
        console.log("[GEN] step=DAILY_USAGE_UPSERT_BEGIN");

        const upsertUrl = `${baseRest}/${DAILY_USAGE_TABLE}?on_conflict=${USER_ID_COL},${DAY_COL}`;

        // OJO: tu tabla tiene user_id TEXT en screenshot, igual mandamos string.
        const nextUsed = usedFreeToday + 1;

        const upsertRes = await fetch(upsertUrl, {
          method: "POST",
          headers: {
            ...sbHeaders,
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            [USER_ID_COL]: String(user_id),
            [DAY_COL]: today,
            [COUNT_COL]: nextUsed,
            updated_at: new Date().toISOString(),
          }),
        });

        if (!upsertRes.ok) {
          const txt = await upsertRes.text().catch(() => "");
          console.log("[GEN] step=DAILY_USAGE_UPSERT_FAIL", upsertRes.status, txt);

          // Si falló el upsert, por seguridad NO damos gratis → pedimos jades
          allowFreeGeneration = false;
        } else {
          console.log("[GEN] step=DAILY_USAGE_UPSERT_OK", { nextUsed });
          usedFreeToday = nextUsed;
        }
      }
    }

    // 5) Cobro de jades SOLO cuando corresponde
    // - Usuarios basic/pro: SIEMPRE cobra jades
    // - Usuarios free: cobra jades SOLO si ya se gastó los 5 gratis
    let billed = { type: "FREE", amount: 0 };

    if (!allowFreeGeneration) {
      console.log("[GEN] step=JADE_CHARGE_BEGIN");

      const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/spend_jades`;
      const ref = body.ref == null ? null : String(body.ref);

      const spendRes = await fetch(rpcUrl, {
        method: "POST",
        headers: sbHeaders,
        body: JSON.stringify({
          p_user_id: user_id,
          p_amount: COST_IMG_PROMPT_JADES,
          p_reason: "generation:img_prompt",
          p_ref: ref,
        }),
      });

      if (!spendRes.ok) {
        const spendTxt = await spendRes.text().catch(() => "");
        console.log("[GEN] step=JADE_CHARGE_FAIL", spendRes.status, spendTxt);

        if ((spendTxt || "").includes("INSUFFICIENT_JADES")) {
          // Si era free y ya usó sus 5 gratis, este error es normal.
          return new Response(
            JSON.stringify({
              ok: false,
              error: "INSUFFICIENT_JADES",
              meta: freeUser
                ? {
                    plan,
                    free_daily_limit: FREE_DAILY_LIMIT,
                    free_used_today: usedFreeToday,
                    note: "Plan free: agotaste tus 5 gratis hoy y no tienes jades.",
                  }
                : { plan, note: "No tienes jades suficientes." },
            }),
            { status: 402, headers: cors }
          );
        }

        return new Response(
          JSON.stringify({
            ok: false,
            error: "RPC_SPEND_JADES_ERROR",
            details: spendTxt,
          }),
          { status: 500, headers: cors }
        );
      }

      console.log("[GEN] step=JADE_CHARGE_OK");
      billed = { type: "JADE", amount: COST_IMG_PROMPT_JADES };
    } else {
      console.log("[GEN] step=FREE_ALLOW_OK", {
        plan,
        usedFreeToday,
        freeLeft: Math.max(0, FREE_DAILY_LIMIT - usedFreeToday),
      });
    }

    // 6) RUNPOD
    console.log("[GEN] step=RUNPOD_BEGIN");

    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const rpKey = process.env.RP_API_KEY || process.env.RUNPOD_API_KEY;

    if (!rpKey || !endpointId) {
      console.log("[GEN] step=MISSING_RP_ENV");
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_RP_ENV",
          detail:
            "Falta RP_API_KEY (o RUNPOD_API_KEY) y endpointId (RUNPOD_ENDPOINT_ID / RP_ENDPOINT).",
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
          plan, // opcional (por debug)
          billed_type: billed.type,
        },
      }),
    });

    if (!rp.ok) {
      const txt = await rp.text().catch(() => "");
      console.log("[GEN] step=RUNPOD_RUN_ERROR", rp.status, txt);

      // Si fue generación gratis y RunPod falló, podrías querer “devolver” el cupo.
      // Por simplicidad (y para no tocar DB extra), lo dejamos así.
      return new Response(JSON.stringify({ ok: false, error: "RUNPOD_RUN_ERROR", details: txt }), {
        status: rp.status,
        headers: cors,
      });
    }

    const data = await rp.json().catch(() => null);
    const jobId = data?.id || data?.requestId || data?.jobId || data?.data?.id;

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
        billed,
        meta: freeUser
          ? {
              plan,
              free_daily_limit: FREE_DAILY_LIMIT,
              free_used_today: usedFreeToday,
              free_left_today: Math.max(0, FREE_DAILY_LIMIT - usedFreeToday),
              note:
                billed.type === "FREE"
                  ? "Generación gratis (plan free)."
                  : "Generación con jades (plan free: ya agotó los 5 gratis).",
            }
          : {
              plan,
              note: "Plan pagado: no aplica límite de 5 gratis. Solo se descuentan jades.",
            },
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