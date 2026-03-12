import { GoogleAuth } from "google-auth-library";

function getGoogleConfig() {
  const projectId = process.env.GOOGLE_PROJECT_ID;
  const location = process.env.GOOGLE_LOCATION;
  const model = process.env.GOOGLE_VEO_MODEL;
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!projectId) throw new Error("Missing GOOGLE_PROJECT_ID");
  if (!location) throw new Error("Missing GOOGLE_LOCATION");
  if (!model) throw new Error("Missing GOOGLE_VEO_MODEL");
  if (!rawJson) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");

  let credentials;
  try {
    credentials = JSON.parse(rawJson);
  } catch (e) {
    throw new Error(
      `Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e?.message || "JSON parse failed"}`
    );
  }

  return { projectId, location, model, credentials };
}

async function getAccessToken() {
  const { credentials } = getGoogleConfig();

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token?.token || token;
}

function stripBase64Prefix(value) {
  if (!value) return null;
  let s = String(value).trim();
  const comma = s.indexOf(",");
  if (s.startsWith("data:") && comma !== -1) {
    s = s.slice(comma + 1);
  }
  return s.replace(/\s+/g, "");
}

// Inicia generación Veo y devuelve operation
export async function generateVeoVideo({
  prompt,
  imageB64,
  imageMimeType = "image/png",
  aspectRatio = "9:16",
  durationSeconds = 8,
}) {
  const { projectId, location, model } = getGoogleConfig();
  const accessToken = await getAccessToken();

  const cleanB64 = stripBase64Prefix(imageB64);
  if (!cleanB64) {
    throw new Error("Veo requires a valid imageB64");
  }

  const endpoint =
    `https://${location}-aiplatform.googleapis.com/v1/` +
    `projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;

  const body = {
    instances: [
      {
        prompt,
        image: {
          bytesBase64Encoded: cleanB64,
          mimeType: imageMimeType,
        },
      },
    ],
    parameters: {
      durationSeconds,
      aspectRatio,
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();

  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
        data?.message ||
        rawText ||
        "Vertex Veo predictLongRunning request failed"
    );
  }

  return data;
}

// Consulta operación Veo
export async function fetchVeoOperation(operationName) {
  if (!operationName) throw new Error("Missing operationName");

  const { projectId, location, model } = getGoogleConfig();
  const accessToken = await getAccessToken();

  const endpoint =
    `https://${location}-aiplatform.googleapis.com/v1/` +
    `projects/${projectId}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      operationName,
    }),
  });

  const rawText = await res.text();

  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
        data?.message ||
        rawText ||
        "Vertex fetchPredictOperation failed"
    );
  }

  return data;
}
