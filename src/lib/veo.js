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

export async function generateVeoVideo({
  prompt,
  imageUrl,
  aspectRatio = "9:16",
  durationSeconds = 8,
}) {
  const { projectId, location, model, credentials } = getGoogleConfig();

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

  const body = {
    instances: [
      {
        prompt,
        image: imageUrl,
        aspectRatio,
      },
    ],
    parameters: {
      durationSeconds,
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken.token}`,
      "Content-Type": "application/json",
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
        "Vertex Veo request failed"
    );
  }

  return data;
}
