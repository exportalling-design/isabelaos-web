import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const AVATAR_BUCKET =
  process.env.SUPABASE_AVATAR_BUCKET ||
  process.env.AVATAR_BUCKET ||
  "avatars";

function normalizeAvatarStatus(raw) {
  const s = String(raw || "").toUpperCase().trim();

  if (!s) return "DRAFT";
  if (["READY", "DONE", "SUCCEEDED", "SUCCESS", "COMPLETED"].includes(s)) return "READY";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(s)) return "FAILED";
  if (["IN_QUEUE", "QUEUED", "QUEUE", "PENDING"].includes(s)) return "IN_QUEUE";
  if (["IN_PROGRESS", "RUNNING", "PROCESSING", "TRAINING"].includes(s)) return "IN_PROGRESS";
  if (["UPLOADING"].includes(s)) return "UPLOADING";
  if (["DRAFT"].includes(s)) return "DRAFT";

  return s;
}

async function makeSignedThumbUrl(path) {
  if (!path) return "";

  try {
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, 60 * 60);

    if (error) {
      console.warn("[avatars-list] signed url error:", error.message);
      return "";
    }

    return data?.signedUrl || "";
  } catch (e) {
    console.warn("[avatars-list] signed url exception:", e?.message || e);
    return "";
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const user_id = String(req.query.user_id || "").trim();
    const only_ready = String(req.query.only_ready || "").trim() === "1";

    if (!user_id) {
      return res.status(400).json({ ok: false, error: "Missing user_id" });
    }

    let query = supabase
      .from("avatars")
      .select("id,name,trigger,status,ref_image_path,lora_path,created_at,updated_at,last_error")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (only_ready) {
      query = query.in("status", ["READY", "DONE", "SUCCEEDED", "SUCCESS", "COMPLETED"]);
    }

    const { data, error } = await query;

    if (error) throw error;

    const avatars = await Promise.all(
      (data || []).map(async (row) => {
        const thumb_url = await makeSignedThumbUrl(row.ref_image_path);

        return {
          id: row.id,
          name: row.name || "Avatar",
          trigger: row.trigger || "",
          status: normalizeAvatarStatus(row.status),
          ref_image_path: row.ref_image_path || null,
          thumb_url,
          lora_path: row.lora_path || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          last_error: row.last_error || null,
        };
      })
    );

    return res.json({
      ok: true,
      avatars,
      count: avatars.length,
    });
  } catch (err) {
    console.error("[avatars-list]", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "SERVER_ERROR",
    });
  }
}
