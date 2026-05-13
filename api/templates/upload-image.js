// api/templates/upload-image.js
// Sube una imagen (base64) a Supabase Storage y retorna la URL pública
// El frontend llama esto antes de llamar submit-video
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { imageBase64, mimeType, label } = body;

  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ ok: false, error: "Missing imageBase64 or mimeType" });
  }

  try {
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const filename = `templates/${userId}/${Date.now()}-${label || "img"}.${ext}`;
    const buffer = Buffer.from(imageBase64, "base64");

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("generations")
      .upload(filename, buffer, { contentType: mimeType, upsert: false });

    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    const { data: pub } = supabaseAdmin.storage
      .from("generations")
      .getPublicUrl(filename);

    if (!pub?.publicUrl) throw new Error("No public URL returned");

    console.log(`[upload-image] OK user=${userId} label=${label} url=${pub.publicUrl.slice(0, 60)}`);
    return res.status(200).json({ ok: true, url: pub.publicUrl });

  } catch (err) {
    console.error("[upload-image] error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export const config = { runtime: "nodejs" };
