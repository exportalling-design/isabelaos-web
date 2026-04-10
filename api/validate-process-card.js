// api/validate-process-card.js
// ─────────────────────────────────────────────────────────────
// Paso 3 del flujo 3DS:
// Se llama DESPUÉS de que el usuario completó el challenge del banco.
// Usa los datos reales del usuario (ciudad, país) que llenó en el formulario.
// ─────────────────────────────────────────────────────────────
import { requireUser }  from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
import { JADE_PACKS }   from "../src/lib/pricing.js";

function getPagaditoBase() {
  return process.env.PAGADITO_ENV === "production"
    ? "https://api.pagadito.com/v1"
    : "https://sandbox-api.pagadito.com/v1";
}

function basicAuth(uid, wsk) {
  return "Basic " + Buffer.from(`${uid}:${wsk}`).toString("base64");
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MISSING_SUPABASE_ENV");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    const user = auth.user;

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { pack, card, transactionId, id_transaction, setupRequestId, referenceId } = body;

    if (!pack || !JADE_PACKS[pack]) return res.status(400).json({ ok: false, error: "INVALID_PACK" });
    if (!transactionId && !id_transaction) return res.status(400).json({ ok: false, error: "MISSING_TRANSACTION_ID" });

    const packInfo = JADE_PACKS[pack];
    const uid      = process.env.PAGADITO_UID;
    const wsk      = process.env.PAGADITO_WSK;
    if (!uid || !wsk) return res.status(500).json({ ok: false, error: "MISSING_PAGADITO_ENV" });

    const merchantTransactionId = `JADE-${pack}-${user.id}-${Date.now()}`;
    const clientIp = getClientIp(req);
    const txId     = transactionId || id_transaction;

    console.log(`[validate-process-card] user=${user.id} pack=${pack} transactionId=${txId}`);

    const url = `${getPagaditoBase()}/validate-process-card/`;
    const r   = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Authorization:  basicAuth(uid, wsk),
      },
      body: JSON.stringify({
        card: {
          number:         card.number.replace(/\s/g, ""),
          expirationDate: card.expirationDate,
          cvv:            card.cvv,
          cardHolderName: card.cardHolderName,
          firstName:      card.firstName,
          lastName:       card.lastName,
          billingAddress: {
            city:      card.city      || "Ciudad",
            state:     card.city      || "Estado",
            zip:       card.zip       || "",
            countryId: card.countryId || "320",
            line1:     card.line1     || "",
            phone:     card.phone     || "",
          },
          email: card.email,
        },
        transaction: {
          merchantTransactionId,
          currencyId: "USD",
          transactionDetails: [{
            quantity:    "1",
            description: `IsabelaOS · ${packInfo.jades} Jades (Pack ${packInfo.label})`,
            amount:      String(packInfo.price_usd.toFixed(2)),
          }],
        },
        browserInfo: {
          deviceFingerprintID: String(Date.now()).slice(-16),
          customerIp:          clientIp,
        },
        consumerAuthenticationInformation: {
          setup_request_id: setupRequestId || "",
          referenceId:      referenceId    || "",
          transactionId:    txId,
        },
      }),
    });

    const data = await r.json().catch(() => null);
    console.log("[validate-process-card] response:", data?.response_code, data?.response_message);

    if (!r.ok || data?.response_code !== "PG200-00") {
      console.log("[validate-process-card] FAILED:", data?.response_code, data?.response_message);
      return res.status(r.status || 402).json({ ok: false, ...data });
    }

    // Acreditar Jades
    const sb           = getSupabaseAdmin();
    const reference_id = data?.customer_reply?.payment_token || data?.request_id || merchantTransactionId;

    const { error: creditErr } = await sb.rpc("credit_jades_from_payment", {
      p_user_id:      user.id,
      p_amount:       packInfo.jades,
      p_reference_id: reference_id,
      p_reason:       `jade_pack:${pack}:3ds`,
    });

    if (creditErr) {
      console.error("[validate-process-card] CREDIT_ERROR:", creditErr.message);
      return res.status(500).json({ ok: false, error: "CREDIT_ERROR", detail: creditErr.message, reference_id });
    }

    console.log("[validate-process-card] ✅ Pago 3DS exitoso:", packInfo.jades, "jades acreditados");

    return res.status(200).json({
      ok:          true,
      pack,
      jades_added: packInfo.jades,
      price_usd:   packInfo.price_usd,
      reference_id,
    });

  } catch (e) {
    console.error("[validate-process-card] SERVER_ERROR:", e?.message);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message) });
  }
}

export const config = { runtime: "nodejs" };
