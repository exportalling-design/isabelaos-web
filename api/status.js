export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }),
      {
        status: 405,
        headers: cors,
      }
    );
  }

  try {
    let jobId = null;

    if (req.method === "GET") {
      const url = new URL(req.url);
      jobId = url.searchParams.get("id");
    } else {
      const body = await req.json().catch(() => null);
      jobId = body?.jobId;
    }

    if (!jobId) {
      return new Response(
        JSON.stringify({ ok: false, error: "MISSING_JOB_ID" }),
        {
          status: 400,
          headers: cors,
        }
      );
    }

    const endpointId = process.env.RUNPOD_ENDPOINT_ID || process.env.RP_ENDPOINT;
    const apiKey = process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_RP_ENV",
          detail: "Falta RP_API_KEY o RUNPOD_ENDPOINT_ID/RP_ENDPOINT",
        }),
        {
          status: 500,
          headers: cors,
        }
      );
    }

    const statusUrl = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;

    console.log("[/api/status] checking job:", jobId);
    console.log("[/api/status] endpointId:", endpointId);

    const rp = await fetch(statusUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!rp.ok) {
      const txt = await rp.text();
      console.log("[/api/status] RUNPOD_STATUS_ERROR raw text:", txt);

      return new Response(
        JSON.stringify({
          ok: false,
          error: "RUNPOD_STATUS_ERROR",
          details: txt,
        }),
        {
          status: rp.status,
          headers: cors,
        }
      );
    }

    const data = await rp.json();
    const out = data?.output || null;

    const image_b64 =
      out?.image_b64 ||
      out?.imageBase64 ||
      out?.imageB64 ||
      out?.image ||
      out?.images?.[0] ||
      out?.result?.image_b64 ||
      out?.result?.imageBase64 ||
      out?.result?.imageB64 ||
      out?.result?.image ||
      (Array.isArray(out) ? out[0] : null) ||
      null;

    const imageUrl =
      out?.imageUrl ||
      out?.url ||
      out?.image_url ||
      out?.result?.imageUrl ||
      out?.result?.url ||
      out?.result?.image_url ||
      null;

    console.log("[/api/status] RUNPOD STATUS RAW:");
    console.log(JSON.stringify(data, null, 2));

    console.log("[/api/status] RUNPOD OUTPUT RAW:");
    console.log(JSON.stringify(out, null, 2));

    console.log("[/api/status] normalized fields:");
    console.log(
      JSON.stringify(
        {
          status: data?.status,
          has_output: !!out,
          has_image_b64: !!image_b64,
          image_b64_length: image_b64 ? String(image_b64).length : 0,
          imageUrl,
          output_keys:
            out && !Array.isArray(out) && typeof out === "object"
              ? Object.keys(out)
              : Array.isArray(out)
              ? ["__array_output__"]
              : [],
        },
        null,
        2
      )
    );

    return new Response(
      JSON.stringify({
        ok: true,
        status: data?.status,
        delayTime: data?.delayTime,
        executionTime: data?.executionTime,
        output: out
          ? {
              ...(Array.isArray(out) ? { items: out } : out),
              image_b64,
              imageUrl,
            }
          : null,
        raw: data,
      }),
      {
        status: 200,
        headers: cors,
      }
    );
  } catch (e) {
    console.log("[/api/status] SERVER_ERROR:");
    console.log(String(e));
    console.log(e?.stack || "NO_STACK");

    return new Response(
      JSON.stringify({
        ok: false,
        error: "SERVER_ERROR",
        details: String(e),
      }),
      {
        status: 500,
        headers: cors,
      }
    );
  }
}

export const config = { runtime: "edge" };
