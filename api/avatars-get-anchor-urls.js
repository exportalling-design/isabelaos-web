import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getAuthUserId(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;

  return data?.user?.id || null;
}

export default async function handler(req, res) {
  try {
    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const bucket = process.env.AVATAR_BUCKET || "avatars";
    const user_id = await getAuthUserId(req);

    if (!user_id) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const avatar_id =
      req.method === "GET"
        ? String(req.query.avatar_id || "")
        : String(req.body?.avatar_id || "");

    const expires_in =
      req.method === "GET"
        ? Number(req.query.expires_in || 3600)
        : Number(req.body?.expires_in || 3600);

    if (!avatar_id) {
      return res.status(400).json({ ok: false, error: "Missing avatar_id" });
    }

    // validar dueño
    const { data: avatar, error: avErr } = await supabase
      .from("avatars")
      .select("id,user_id")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) {
      return res.status(404).json({ ok: false, error: "Avatar not found" });
    }

    if (avatar.user_id !== user_id) {
      return res.status(403).json({ ok: false, error: "Not your avatar" });
    }

    // construir paths esperados
    const possiblePaths = [
      `${user_id}/${avatar_id}/anchors/anchor_1.jpg`,
      `${user_id}/${avatar_id}/anchors/anchor_2.jpg`,
      `${user_id}/${avatar_id}/anchors/anchor_3.jpg`,
      `${user_id}/${avatar_id}/anchors/anchor_1.png`,
      `${user_id}/${avatar_id}/anchors/anchor_2.png`,
      `${user_id}/${avatar_id}/anchors/anchor_3.png`,
      `${user_id}/${avatar_id}/anchors/anchor_1.jpeg`,
      `${user_id}/${avatar_id}/anchors/anchor_2.jpeg`,
      `${user_id}/${avatar_id}/anchors/anchor_3.jpeg`,
      `${user_id}/${avatar_id}/anchors/anchor_1.webp`,
      `${user_id}/${avatar_id}/anchors/anchor_2.webp`,
      `${user_id}/${avatar_id}/anchors/anchor_3.webp`,
    ];

    const results = [];

    for (const storage_path of possiblePaths) {
      const { data: signed, error: sErr } = await supabase.storage
        .from(bucket)
        .createSignedUrl(storage_path, expires_in);

      if (!sErr && signed?.signedUrl) {
        results.push({
          storage_path,
          url: signed.signedUrl,
        });
      }
    }

    return res.json({
      ok: true,
      avatar_id,
      expires_in,
      anchors: results,
      count: results.length,
    });
  } catch (err) {
    console.error("[avatars-get-anchor-urls]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
