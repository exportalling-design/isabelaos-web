// api/_googleVertex.js
// Helper de Vertex AI para Vercel usando:
// - GOOGLE_SERVICE_ACCOUNT_JSON
// - GOOGLE_PROJECT_ID
// - GOOGLE_LOCATION
// - VERTEX_GEMINI_MODEL (opcional)

import crypto from "crypto";

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const SERVICE_ACCOUNT = safeJsonParse(
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "",
  {}
);

export const VERTEX_PROJECT_ID =
  process.env.GOOGLE_PROJECT_ID ||
  process.env.VERTEX_PROJECT_ID ||
  SERVICE_ACCOUNT.project_id ||
  "";

export const VERTEX_LOCATION =
  process.env.GOOGLE_LOCATION ||
  process.env.VERTEX_LOCATION ||
  "global";

// Puedes cambiar este default si quieres luego.
// Por ahora lo dejamos estable.
export const VERTEX_GEMINI_MODEL =
  process.env.VERTEX_GEMINI_MODEL ||
  "gemini-2.0-flash-001";

const GOOGLE_CLIENT_EMAIL =
  SERVICE_ACCOUNT.client_email ||
  process.env.GOOGLE_CLIENT_EMAIL ||
  "";

const GOOGLE_PRIVATE_KEY =
  (SERVICE_ACCOUNT.private_key || process.env.GOOGLE_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

function base64Url(input) {
  const buffer = Buffer.isBuffer(input)
    ? input
    : Buffer.from(typeof input === "string" ? input : JSON.stringify(input));

  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createJwt() {
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "Faltan client_email o private_key en GOOGLE_SERVICE_ACCOUNT_JSON."
    );
  }

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64Url(header);
  const encodedPayload = base64Url(payload);
  const unsigned = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();

  const signature = signer.sign(GOOGLE_PRIVATE_KEY);
  const encodedSignature = base64Url(signature);

  return `${unsigned}.${encodedSignature}`;
}

async function getAccessToken() {
  const now = Date.now();

  if (tokenCache.accessToken && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const assertion = createJwt();

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw new Error(
      `No se pudo obtener access token: ${resp.status} ${JSON.stringify(data)}`
    );
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  return tokenCache.accessToken;
}

function buildVertexUrl({ projectId, location, model }) {
  const base =
    location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${location}-aiplatform.googleapis.com`;

  return `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

export function extractTextFromVertexResponse(data) {
  if (!data) return "";

  const parts = data?.candidates?.[0]?.content?.parts || [];

  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function vertexFetch({
  model = VERTEX_GEMINI_MODEL,
  location = VERTEX_LOCATION,
  projectId = VERTEX_PROJECT_ID,
  contents,
  systemInstruction,
  generationConfig,
  safetySettings,
}) {
  if (!projectId) {
    throw new Error("Falta GOOGLE_PROJECT_ID.");
  }

  const accessToken = await getAccessToken();
  const url = buildVertexUrl({ projectId, location, model });

  const body = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(generationConfig ? { generationConfig } : {}),
    ...(safetySettings ? { safetySettings } : {}),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `Vertex error ${resp.status}`;

    const err = new Error(msg);
    err.status = resp.status;
    err.details = data;
    err.vertexUrl = url;
    throw err;
  }

  return data;
}
