// api/jades-setup.js
// ─────────────────────────────────────────────────────────────
// Paso 1: Llama setup-payer y devuelve los tokens al frontend
// El frontend usa estos tokens para hacer el iframe de Cardinal
// ─────────────────────────────────────────────────────────────
import { requireUser } from "./_auth.js";
import { JADE_PACKS }  from "../src/lib/pricing.js";

function getPagaditoBase() {
  return process.env.PAGADITO_ENV === "production"
    ? "https://api.pagadito.com/v1"
    : "https://sandbox-api.pagadito.com/v1";
}

function basicAuth(uid, wsk) {
  return "Basic " + Buffer.from(`${uid}:${wsk}`).toString("base64");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { pack, card } = body;

    if (!pack || !JADE_PACKS[pack]) {
      return res.status(400).json({ ok: false, error: "INVALID_PACK" });
    }
    if (!card?.number || !card?.expirationDate || !card?.cvv || !card?.cardHolderName) {
      return res.status(400).json({ ok: false, error: "MISSING_CARD_FIELDS" });
    }

    const uid = process.env.PAGADITO_UID;
    const wsk = process.env.PAGADITO_WSK;
    if (!uid || !wsk) return res.status(500).json({ ok: false, error: "MISSING_PAGADITO_ENV" });

    const url = `${getPagaditoBase()}/setup-payer/`;
    console.log("[jades-setup] calling setup-payer...", process.env.PAGADITO_ENV, url);

    const r = await fetch(url, {
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
        },
      }),
    });

    const data = await r.json().catch(() => null);
    console.log("[jades-setup] response:", data?.response_code, data?.response_message);

    if (!r.ok || data?.response_code !== "PG200-00") {
      return res.status(r.status || 400).json({ ok: false, ...data });
    }

    return res.status(200).json({
      ok:                      true,
      request_id:              data.request_id,
      accessToken:             data.accessToken,
      referenceId:             data.referenceId,
      deviceDataCollectionUrl: data.deviceDataCollectionUrl ||
        (process.env.PAGADITO_ENV === "production"
          ? "https://centinelapi.cardinalcommerce.com/V1/Cruise/Collect"
          : "https://centinelapistag.cardinalcommerce.com/V1/Cruise/Collect"),
    });

  } catch (e) {
    console.error("[jades-setup] ERROR:", e?.message);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", detail: String(e?.message) });
  }
}

export const config = { runtime: "nodejs" };