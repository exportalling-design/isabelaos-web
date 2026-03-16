// api/_googleVertex.js
// Vertex AI helper para Vercel / Node runtime
// Usa endpoint global + Gemini 2.0 Flash versión explícita.

import crypto from "crypto";

export const VERTEX_PROJECT_ID =
  process.env.VERTEX_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCP_PROJECT_ID ||
  process.env.GOOGLE_PROJECT_ID ||
  "helpful-metric-376223";

export const VERTEX_LOCATION =
  process.env.VERTEX_LOCATION ||
  "global";

export const VERTEX_GEMINI_MODEL =
  process.env.VERTEX_GEMINI_MODEL ||
  "gemini-2.0-flash-001";

const GOOGLE_CLIENT_EMAIL =
  process.env.GOOGLE_CLIENT_EMAIL ||
  process.env.GCP_CLIENT_EMAIL ||
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  "";

const GOOGLE_PRIVATE_KEY_RAW =
  process.env.GOOGLE_PRIVATE_KEY ||
  process.env.GCP_PRIVATE_KEY ||
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
  "";

const GOOGLE_PRIVATE_KEY = GOOGLE_PRIVATE_KEY_RAW.replace(/\\n/g, "\n");

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
      "Faltan credenciales de Google. Revisa GOOGLE_CLIENT_EMAIL y GOOGLE_PRIVATE_KEY en Vercel."
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

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(
      `No se pudo obtener access token de Google: ${resp.status} ${JSON.stringify(data)}`
    );
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  return tokenCache.accessToken;
}

function buildVertexUrl({ model, location, projectId }) {
  const base =
    location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${location}-aiplatform.googleapis.com`;

  return `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

export function extractTextFromVertexResponse(data) {
  if (!data) return "";

  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  const text = parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  return text;
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
    throw new Error("Falta VERTEX_PROJECT_ID / GOOGLE_PROJECT_ID.");
  }

  const accessToken = await getAccessToken();
  const url = buildVertexUrl({ model, location, projectId });

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
    throw err;
  }

  return data;
}
