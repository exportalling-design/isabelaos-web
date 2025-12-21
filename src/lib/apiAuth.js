// lib/apiAuth.js
import { createClient } from "@supabase/supabase-js";

export function sbAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function requireUser(req) {
  const sb = sbAdmin();

  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    const err = new Error("UNAUTHORIZED");
    err.statusCode = 401;
    throw err;
  }

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error("UNAUTHORIZED");
    err.statusCode = 401;
    throw err;
  }

  return { sb, user: data.user };
}

export async function getActivePlan(sb, user_id) {
  const { data, error } = await sb
    .from("user_subscription")
    .select("plan,status")
    .eq("user_id", user_id)
    .single();

  if (error && error.code !== "PGRST116") throw error;

  const isActive = data?.status === "active";
  return {
    plan: isActive ? data.plan : null,
    status: data?.status || "none",
  };
}

export async function getTodayImageCount(sb, user_id) {
  // Cuenta en "generations" solo del día
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const { count, error } = await sb
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user_id)
    .eq("kind", "img_prompt")
    .gte("created_at", start.toISOString());

  if (error) throw error;
  return count || 0;
}

export async function spendJades(sb, user_id, kind, ref) {
  // kind debe coincidir con tu RPC spend_jades
  const COSTS = {
    img_prompt: 1,
    img_transform: 2,
    vid_prompt: 10,
    vid_img2vid: 12,
  };

  const cost = COSTS[kind];
  if (!cost) {
    const err = new Error("INVALID_KIND");
    err.statusCode = 400;
    throw err;
  }

  const { data, error } = await sb.rpc("spend_jades", {
    p_user_id: user_id,
    p_amount: cost,
    p_reason: `generation:${kind}`,
    p_ref: ref || null,
  });

  if (error) {
    if ((error.message || "").includes("INSUFFICIENT_JADES")) {
      const err = new Error("INSUFFICIENT_JADES");
      err.statusCode = 402;
      throw err;
    }
    throw error;
  }

  return { cost, new_balance: data?.[0]?.new_balance ?? null };
}
