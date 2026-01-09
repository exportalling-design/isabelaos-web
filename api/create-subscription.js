// /api/create-subscription.js
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

// =====================
// ENV (soporta con y sin VITE_)
// =====================
const PAYPAL_CLIENT_ID =
  process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID;

const PAYPAL_CLIENT_SECRET =
  process.env.PAYPAL_CLIENT_SECRET || process.env.VITE_PAYPAL_CLIENT_SECRET;

const PAYPAL_MODE =
  (process.env.PAYPAL_MODE ||
    process.env.PAYPAL_ENV ||
    process.env.VITE_PAYPAL_ENV ||
    "live").toLowerCase();

const PAYPAL_PLAN_ID_BASIC =
  process.env.PAYPAL_PLAN_ID_BASIC || process.env.VITE_PAYPAL_PLAN_ID_BASIC;

const PAYPAL_PLAN_ID_PRO =
  process.env.PAYPAL_PLAN_ID_PRO || process.env.VITE_PAYPAL_PLAN_ID_PRO;

// URL pública de tu web (ej: https://isabelaos-web.vercel.app o https://isabelaos.com)
const APP_BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.VITE_APP_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_BASE_URL;

// ✅ Supabase (service role para escribir mapping server-side)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAYPAL_API_BASE =
  PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

function must(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

async function paypalAccessToken() {
  const basic = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const r = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal token error: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

function planIdForTier(tier) {
  if (tier === "basic") return PAYPAL_PLAN_ID_BASIC;
  if (tier === "pro") return PAYPAL_PLAN_ID_PRO;
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const auth = await requireUser(req);
    if (!auth.ok) {
      return res.status(auth.code || 401).json({ ok: false, error: auth.error });
    }

    must("PAYPAL_CLIENT_ID(or VITE_PAYPAL_CLIENT_ID)", PAYPAL_CLIENT_ID);
    must("PAYPAL_CLIENT_SECRET(or VITE_PAYPAL_CLIENT_SECRET)", PAYPAL_CLIENT_SECRET);
    must("PAYPAL_PLAN_ID_BASIC(or VITE_PAYPAL_PLAN_ID_BASIC)", PAYPAL_PLAN_ID_BASIC);
    must("PAYPAL_PLAN_ID_PRO(or VITE_PAYPAL_PLAN_ID_PRO)", PAYPAL_PLAN_ID_PRO);
    must("APP_BASE_URL", APP_BASE_URL);

    // ✅ necesario para guardar mapping antes del approve
    must("SUPABASE_URL (o VITE_SUPABASE_URL)", SUPABASE_URL);
    must("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);

    const { tier } = req.body || {};
    const t = String(tier || "").toLowerCase();
    const plan_id = planIdForTier(t);

    if (!plan_id) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_TIER",
        allowed: ["basic", "pro"],
      });
    }

    const accessToken = await paypalAccessToken();

    // ✅ URLs de retorno/cancelación (SIN popup)
    // Cambiado para volver al Dashboard ("/") con query params de estado
    // - Si está logueado: App.jsx renderiza DashboardView
    // - Si no: caerá en Landing y el usuario inicia sesión
    const return_url = `${APP_BASE_URL}/?pp=success&tier=${encodeURIComponent(t)}`;
    const cancel_url = `${APP_BASE_URL}/?pp=cancel&tier=${encodeURIComponent(t)}`;

    const payload = {
      plan_id,
      custom_id: auth.user.id, // ✅ lo mandamos igual, pero ya NO dependemos de que vuelva en webhook
      application_context: {
        brand_name: "IsabelaOS Studio",
        user_action: "SUBSCRIBE_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url,
        cancel_url,
        locale: "es-GT",
      },
    };

    const r = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: "PAYPAL_CREATE_SUB_FAILED",
        details: j,
      });
    }

    const subscription_id = j?.id || null;

    // ✅ PARCHE #1: Guardar mapping subscription_id -> user_id ANTES del approve
    if (subscription_id) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const row = {
        subscription_id,
        user_id: auth.user.id,
        custom_id: auth.user.id,
        plan_id,
        status: "APPROVAL_PENDING",
        updated_at: new Date().toISOString(),
        // requiere columna en tabla; si no existe, Supabase devolverá error:
        credited_once: false,
      };

      const { error } = await supabase
        .from("paypal_subscriptions")
        .upsert(row, { onConflict: "subscription_id" });

      if (error) {
        return res.status(500).json({
          ok: false,
          error: "SUPABASE_SUB_INSERT_FAILED",
          details: error,
        });
      }
    }

    const approveUrl = Array.isArray(j?.links)
      ? j.links.find((x) => x?.rel === "approve")?.href
      : null;

    return res.status(200).json({
      ok: true,
      tier: t,
      plan_id,
      subscription_id,
      approve_url: approveUrl,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "CREATE_SUBSCRIPTION_FATAL",
      details: e?.message || String(e),
    });
  }
}
