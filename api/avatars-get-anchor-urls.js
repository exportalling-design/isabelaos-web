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
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const avatar_id = String(req.query.avatar_id || "").trim();
    const user_id = await getAuthUserId(req);

    if (!user_id) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    if (!avatar_id) {
      return res.status(400).json({ ok: false, error: "Missing avatar_id" });
    }

    const { data: avatar, error: avatarErr } = await supabase
      .from("avatars")
      .select("id,user_id")
      .eq("id", avatar_id)
      .single();

    if (avatarErr || !avatar) {
      return res.status(404).json({ ok: false, error: "Avatar not found" });
    }

    if (avatar.user_id !== user_id) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const { data: rows, error } = await supabase
      .from("avatar_anchor_photos")
      .select("id,anchor_index,storage_path,created_at")
      .eq("avatar_id", avatar_id)
      .order("anchor_index", { ascending: true });

    if (error) throw error;

    const anchors = await Promise.all(
      (rows || []).map(async (row) => {
        const { data: signed, error: sErr } = await supabase.storage
          .from(process.env.SUPABASE_AVATAR_BUCKET || process.env.AVATAR_BUCKET || "avatars")
          .createSignedUrl(row.storage_path, 3600);

        return {
          id: row.id,
          anchor_index: row.anchor_index,
          storage_path: row.storage_path,
          url: sErr ? "" : signed?.signedUrl || "",
          created_at: row.created_at || null,
        };
      })
    );

    return res.json({
      ok: true,
      anchors,
    });
  } catch (err) {
    console.error("[avatars-get-anchor-urls]", err);
    return res.status(500).json({ ok: false, error: err.message || "SERVER_ERROR" });
  }
}
