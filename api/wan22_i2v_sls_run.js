// api/wan22_i2v_sls_run.js
export default async function handler(req) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "content-type": "application/json; charset=utf-8",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: cors,
    });
  }

  try {
    const body = await req.json().catch(() => null);

    const prompt = body?.prompt;
    const negative = body?.negative || "";
    const seconds = body?.seconds ?? 4;
    const fps = body?.fps ?? 16;
    const seed = body?.seed ?? -1;

    const imageUrl = body?.imageUrl || null;
    const imageB64 = body?.imageB64 || body?.image_b64 || null;

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_PROMPT" }), {
        status: 400,
        headers: cors,
      });
    }
    if (!imageUrl && !imageB64) {
      return new Response(JSON.stringify({ ok: false, error: "MISSING_IMAGE" }), {
        status: 400,
        headers: cors,
      });
    }

    const endpointId = process.env.RP_WAN22_I2V_ENDPOINT;
    const apiKey = process.env.RP_SLS_API_KEY || process.env.RP_API_KEY;

    if (!apiKey || !endpointId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MISSING_RP_ENV",
          detail: "Falta RP_SLS_API_KEY/RP_API_KEY o RP_WAN22_I2V_ENDPOINT",
        }),
        { status: 500, headers: cors }
      );
    }

    const runUrl = `https://api.runpod.ai/v2/${endpointId}/run`;

    const input = {
      mode: "i2v",
      prompt,
      negative,
      seconds,
      fps,
      seed,
      imageUrl,
      imageB64,
      // opcional:
      steps: body?.steps ?? 25,
      guidance: body?.guidance ?? 7,
    };

    const rp = await fetch(runUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    });

    if (!rp.ok) {
      const txt = await rp.text();
      return new Response(JSON.stringify({ ok: false, error: "RUNPOD_RUN_ERROR", details: txt }), {
        status: rp.status,
        headers: cors,
      });
    }

    const data = await rp.json();

    return new Response(
      JSON.stringify({
        ok: true,
        jobId: data?.id || null,
        status: data?.status || null,
        raw: data,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "SERVER_ERROR", details: String(e) }), {
      status: 500,
      headers: cors,
    });
  }
}

export const config = { runtime: "edge" };
