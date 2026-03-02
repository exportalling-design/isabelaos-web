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
      return res.status(405).json({ error: "Method not allowed" });
    }

    const bucket = process.env.AVATAR_BUCKET || "avatars";
    const user_id = await getAuthUserId(req);
    if (!user_id) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

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
      .select("id,user_id,ref_image_path")
      .eq("id", avatar_id)
      .single();

    if (avErr || !avatar) return res.status(404).json({ ok: false, error: "Avatar not found" });
    if (avatar.user_id !== user_id) return res.status(403).json({ ok: false, error: "Not your avatar" });

    const { data: photos, error: pErr } = await supabase
      .from("avatar_photos")
      .select("id,storage_path,created_at")
      .eq("avatar_id", avatar_id)
      .order("created_at", { ascending: true });

    if (pErr) throw pErr;

    const list = photos || [];

    const signedList = await Promise.all(
      list.map(async (p) => {
        const { data: signed, error: sErr } = await supabase.storage
          .from(bucket)
          .createSignedUrl(p.storage_path, expires_in);
        if (sErr) throw sErr;

        return {
          id: p.id,
          storage_path: p.storage_path,
          url: signed?.signedUrl || null,
          created_at: p.created_at,
          is_thumbnail: avatar.ref_image_path === p.storage_path,
        };
      })
    );

    return res.json({ ok: true, avatar_id, expires_in, photos: signedList });
  } catch (err) {
    console.error("[avatars-get-photo-urls]", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
