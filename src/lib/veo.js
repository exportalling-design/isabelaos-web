import { GoogleAuth } from "google-auth-library";

const projectId = process.env.GOOGLE_PROJECT_ID;
const location = process.env.GOOGLE_LOCATION;
const model = process.env.GOOGLE_VEO_MODEL;

const auth = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

export async function generateVeoVideo({
  prompt,
  imageUrl,
  aspectRatio = "9:16",
  durationSeconds = 8,
}) {
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
