// api/_googleVertex.js
import { JWT } from "google-auth-library";

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export function getGoogleConfig() {
  const raw = getEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  const creds = JSON.parse(raw);

  return {
    projectId: process.env.GOOGLE_PROJECT_ID || creds.project_id,
    location: process.env.GOOGLE_LOCATION || "global",
    clientEmail: creds.client_email,
    privateKey: String(creds.private_key || "").replace(/\\n/g, "\n"),
  };
}

export async function getGoogleAccessToken() {
  const { clientEmail, privateKey } = getGoogleConfig();

  const client = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const { access_token } = await client.authorize();
  if (!access_token) throw new Error("GOOGLE_ACCESS_TOKEN_MISSING");
  return access_token;
}

export async function vertexFetch(path, body) {
  const { projectId, location } = getGoogleConfig();
  const accessToken = await getGoogleAccessToken();

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}${path}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await r.json().catch(() => null);

  if (!r.ok) {
    const msg =
      json?.error?.message ||
      json?.error ||
      `Vertex request failed (${r.status})`;
    throw new Error(msg);
  }

  return json;
}
