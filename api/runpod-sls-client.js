// /api/runpod-sls-client.js
export async function runpodServerlessRun({ endpointId, apiKey, input }) {
  if (!endpointId) throw new Error("Missing endpointId");
  if (!apiKey) throw new Error("Missing RUNPOD_SLS_API_KEY");

  const url = `https://api.runpod.ai/v2/${endpointId}/run`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error || data?.message || `RunPod error (${r.status})`;
    throw new Error(msg);
  }

  return data; // normalmente devuelve { id, status, ... }
}

export async function runpodServerlessStatus({ endpointId, apiKey, requestId }) {
  const url = `https://api.runpod.ai/v2/${endpointId}/status/${requestId}`;

  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error || data?.message || `RunPod status error (${r.status})`;
    throw new Error(msg);
  }

  return data;
}
