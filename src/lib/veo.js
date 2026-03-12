import { GoogleAuth } from "google-auth-library";

function getGoogleConfig() {
  const projectId = process.env.GOOGLE_PROJECT_ID;
  const location = process.env.GOOGLE_LOCATION;
  const model = process.env.GOOGLE_VEO_MODEL;
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const outputStorageUri = process.env.GOOGLE_VEO_OUTPUT_STORAGE_URI || "";

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

  return { projectId, location, model, credentials, outputStorageUri };
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

export async function generateVeoVideo({
  prompt,
  imageB64,
  imageMimeType = "image/png",
  aspectRatio = "9:16",
  durationSeconds = 8,
}) {
  const { projectId, location, model, outputStorageUri } = getGoogleConfig();
  const accessToken = await getAccessToken();

  if (!imageB64) {
    throw new Error("Veo requires imageB64");
  }

  const endpoint =
    `https://${location}-aiplatform.googleapis.com/v1/` +
    `projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;

  const body = {
    instances: [
      {
        prompt,
        referenceImages: [
          {
            image: {
              bytesBase64Encoded: imageB64,
              mimeType: imageMimeType,
            },
            referenceType: "asset",
          },
        ],
      },
    ],
    parameters: {
      aspectRatio,
      durationSeconds,
      sampleCount: 1,
      ...(outputStorageUri ? { storageUri: outputStorageUri } : {}),
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
