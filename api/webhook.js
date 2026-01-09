// /api/webhook.js
import { createClient } from "@supabase/supabase-js";
import getRawBody from "raw-body";

export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_MODE = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();

// Plan mapping + jades incluidos
const PAYPAL_PLAN_ID_BASIC = process.env.PAYPAL_PLAN_ID_BASIC;
const PAYPAL_PLAN_ID_PRO = process.env.PAYPAL_PLAN_ID_PRO;
const BASIC_INCLUDED_JADES = process.env.BASIC_INCLUDED_JADES;
const PRO_INCLUDED_JADES = process.env.PRO_INCLUDED_JADES;

const PAYPAL_API_BASE =
  PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

function must(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

function isDuplicateKeyError(err) {
  return (
    err?.code === "23505" ||
    (typeof err?.message === "string" && err.message.toLowerCase().includes("duplicate key"))
  );
}

function isUuid(s) {
  return (
    typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  );
}

// Headers case-insensitive
function getHeaderCI(headers, name) {
  if (!headers) return "";
  const target = String(name || "").toLowerCase();
  const keys = Object.keys(headers);
  const foundKey = keys.find((k) => String(k).toLowerCase() === target);
  if (!foundKey) return "";
  const v = headers[foundKey];
  if (Array.isArray(v)) return v[0] || "";
  return v || "";
}

async function paypalAccessToken() {
  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
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

async function verifyWebhookSignature({ event, headers }) {
  const transmissionId = getHeaderCI(headers, "paypal-transmission-id");
  const transmissionTime = getHeaderCI(headers, "paypal-transmission-time");
  const certUrl = getHeaderCI(headers, "paypal-cert-url");
  const authAlgo = getHeaderCI(headers, "paypal-auth-algo");
  const transmissionSig = getHeaderCI(headers, "paypal-transmission-sig");

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return { verified: false, error: "Missing PayPal signature headers" };
  }

  const accessToken = await paypalAccessToken();

  const payload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: event,
  };

  const r = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => ({}));
  const ok = r.ok && j?.verification_status === "SUCCESS";
  return { verified: ok, error: ok ? null : `verify_failed: ${JSON.stringify(j)}` };
}

function normalizeSubscriptionLike(resource) {
  const subscription_id = resource?.id || null;
  const status = resource?.status || resource?.state || null;
  const plan_id = resource?.plan_id || null;

  const payer_id =
    resource?.subscriber?.payer_id ||
    resource?.payer?.payer_id ||
    resource?.payer?.payer_info?.payer_id ||
    null;

  const custom_id = resource?.custom_id || null;
  const user_id = isUuid(custom_id) ? custom_id : null;

  return { subscription_id, status, plan_id, payer_id, custom_id, user_id };
}

// ✅ PARCHE #2: UPSERT SIN PISAR CON NULL (merge con lo existente)
async function upsertPaypalSubscription({ supabase, resource }) {
  const n = normalizeSubscriptionLike(resource);
  if (!n.subscription_id) return { ok: false, reason: "no_subscription_id" };

  // leer existente
  const { data: existing, error: readErr } = await supabase
    .from("paypal_subscriptions")
    .select("subscription_id, user_id, custom_id, plan_id, status, payer_id, credited_once")
    .eq("subscription_id", n.subscription_id)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr };

  const merged = {
    subscription_id: n.subscription_id,

    status: n.status ?? existing?.status ?? null,
    plan_id: n.plan_id ?? existing?.plan_id ?? null,
    payer_id: n.payer_id ?? existing?.payer_id ?? null,

    // 🔥 clave: NO borrar mapping si PayPal no manda custom_id
    custom_id: n.custom_id ?? existing?.custom_id ?? null,
    user_id: n.user_id ?? existing?.user_id ?? null,

    credited_once: existing?.credited_once ?? false,

    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from("paypal_subscriptions")
    .upsert(merged, { onConflict: "subscription_id" });

  if (upsertErr) return { ok: false, error: upsertErr };

  return { ok: true, ...merged };
}

// plan_id -> plan
function planFromPayPalPlanId(plan_id) {
  if (plan_id && PAYPAL_PLAN_ID_BASIC && plan_id === PAYPAL_PLAN_ID_BASIC) return "basic";
  if (plan_id && PAYPAL_PLAN_ID_PRO && plan_id === PAYPAL_PLAN_ID_PRO) return "pro";
  return null;
}

function includedJadesForPlan(plan) {
  if (plan === "basic") return Number(BASIC_INCLUDED_JADES || 0);
  if (plan === "pro") return Number(PRO_INCLUDED_JADES || 0);
  return 0;
}

function isActiveStatus(status) {
  return String(status || "").toLowerCase() === "active";
}

// ✅ NUEVO: sincroniza profiles.plan cuando la subscripción ya es ACTIVE
async function syncProfilePlanIfActive({ supabase, user_id, plan, subscription_id }) {
  if (!user_id || !plan) return { ok: false, skipped: true, reason: "missing_user_or_plan" };

  const { error: updErr } = await supabase
    .from("profiles")
    .update({ plan, updated_at: new Date().toISOString() })
    .eq("id", user_id);

  if (updErr) {
    console.error("[PP_WEBHOOK] profiles_plan_update_failed", { user_id, plan, subscription_id, updErr });
    return { ok: false, error: updErr };
  }

  console.log("[PP_WEBHOOK] profiles_plan_updated", { user_id, plan, subscription_id });
  return { ok: true };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true, ignored: true });

    must("SUPABASE_URL (o VITE_SUPABASE_URL)", SUPABASE_URL);
    must("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
    must("PAYPAL_CLIENT_ID", PAYPAL_CLIENT_ID);
    must("PAYPAL_CLIENT_SECRET", PAYPAL_CLIENT_SECRET);
    must("PAYPAL_WEBHOOK_ID", PAYPAL_WEBHOOK_ID);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const raw = await getRawBody(req);
    const rawText = raw.toString("utf8");

    let event;
    try {
      event = JSON.parse(rawText);
    } catch {
      event = { parse_error: true, raw: rawText };
    }

    const eventId = event?.id || `no-id-${Date.now()}`;
    const eventType = event?.event_type || null;
    const resourceType = event?.resource_type || null;

    // verify (en sandbox a veces falla)
    let verified = false;
    let verifyError = null;
    try {
      const v = await verifyWebhookSignature({ event, headers: req.headers });
      verified = v.verified;
      verifyError = v.error;
    } catch (e) {
      verified = false;
      verifyError = `verify_exception: ${String(e?.message || e)}`;
    }

    // idempotencia de evento
    const { data: alreadyProcessed } = await supabase
      .from("paypal_events_processed")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();

    if (alreadyProcessed?.event_id) {
      return res.status(200).json({ ok: true, already_processed: true, verified });
    }

    // guardar raw
    const insertPayload = {
      id: eventId,
      event_type: eventType,
      resource_type: resourceType,
      verified,
      error: verifyError,
      payload: event,
      headers: req.headers,
      received_at: new Date().toISOString(),
    };

    const { error: rawInsertErr } = await supabase.from("paypal_events_raw").insert(insertPayload);
    if (rawInsertErr && !isDuplicateKeyError(rawInsertErr)) {
      console.error("[PP_WEBHOOK] raw_insert_error", rawInsertErr);
      return res.status(200).json({ ok: false, stored: false, verified });
    }

    // procesar suscripción
    const resource = event?.resource || null;

    if (eventType && eventType.startsWith("BILLING.SUBSCRIPTION.") && resource) {
      const subRes = await upsertPaypalSubscription({ supabase, resource });

      console.log("[PP_WEBHOOK] subscription_seen", {
        eventType,
        subscription_id: subRes?.subscription_id,
        status: subRes?.status,
        plan_id: subRes?.plan_id,
        payer_id: subRes?.payer_id,
        custom_id: subRes?.custom_id,
        user_id: subRes?.user_id,
        credited_once: subRes?.credited_once,
      });

      // ✅ NUEVO: si ya está ACTIVE, sincroniza plan a profiles (aunque todavía no se acrediten jades)
      if (subRes.ok && subRes.user_id && isActiveStatus(subRes.status)) {
        const plan = planFromPayPalPlanId(subRes.plan_id);
        if (plan) {
          await syncProfilePlanIfActive({
            supabase,
            user_id: subRes.user_id,
            plan,
            subscription_id: subRes.subscription_id,
          });
        } else {
          console.log("[PP_WEBHOOK] cannot_sync_plan_no_mapping", {
            plan_id: subRes.plan_id,
            subscription_id: subRes.subscription_id,
          });
        }
      }

      // ✅ acreditar SOLO 1 vez cuando ACTIVE y con user_id
      if (subRes.ok && subRes.user_id && isActiveStatus(subRes.status)) {
        if (subRes.credited_once) {
          console.log("[PP_WEBHOOK] already_credited_once", subRes.subscription_id);
        } else {
          const plan = planFromPayPalPlanId(subRes.plan_id);
          const amount = includedJadesForPlan(plan);

          if (plan && amount > 0) {
            const ref = `ppsub:${subRes.subscription_id}:first`;

            const { error: creditErr } = await supabase.rpc("add_jades", {
              p_user_id: subRes.user_id,
              p_amount: amount,
              p_reason: `subscription:${plan}`,
              p_ref: ref,
            });

            if (creditErr) {
              console.error("[PP_WEBHOOK] credit_failed", creditErr);
            } else {
              console.log("[PP_WEBHOOK] credit_ok", { user_id: subRes.user_id, plan, amount });

              // marcar acreditado
              const { error: markErr } = await supabase
                .from("paypal_subscriptions")
                .update({ credited_once: true, updated_at: new Date().toISOString() })
                .eq("subscription_id", subRes.subscription_id);

              if (markErr) console.error("[PP_WEBHOOK] mark_credited_once_failed", markErr);
            }
          } else {
            console.log("[PP_WEBHOOK] no_plan_mapping_or_amount", {
              plan_id: subRes.plan_id,
              plan,
              amount,
            });
          }
        }
      } else {
        console.log("[PP_WEBHOOK] no_credit_yet", {
          has_user_id: !!subRes?.user_id,
          status: subRes?.status,
          note: "Si user_id viene NULL, revisa que create-subscription haya guardado mapping.",
        });
      }
    }

    // marcar procesado
    const { error: processedErr } = await supabase
      .from("paypal_events_processed")
      .insert({ event_id: eventId, processed_at: new Date().toISOString() });

    if (processedErr && !isDuplicateKeyError(processedErr)) {
      console.error("[PP_WEBHOOK] processed_insert_error", processedErr);
    }

    return res.status(200).json({ ok: true, stored: true, verified });
  } catch (e) {
    console.error("[PP_WEBHOOK] exception", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}