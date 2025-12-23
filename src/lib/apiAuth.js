// fuente/biblioteca/apiAuth.js
import { createClient } from "@supabase/supabase-js";

function sbAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing env SUPABASE_URL");
  if (!key) throw new Error("Missing env SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Lee el token desde:
 * - Authorization: Bearer <token>
 * - o cookie "sb-access-token" / "access_token" (por si acaso)
 */
export async function requireUser(req) {
  const admin = sbAdmin();

  const auth = req.headers?.authorization || req.headers?.Authorization || "";
  let token = "";

  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  }

  // fallback: cookies (opcional)
  if (!token && typeof req.headers?.cookie === "string") {
    const c = req.headers.cookie;
    const pick = (name) => {
      const m = c.match(new RegExp(`${name}=([^;]+)`));
      return m ? decodeURIComponent(m[1]) : "";
    };
    token = pick("sb-access-token") || pick("access_token") || "";
  }

  if (!token) {
    return { ok: false, error: "LOGIN_REQUIRED", detail: "NO_TOKEN" };
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    return {
      ok: false,
      error: "LOGIN_REQUIRED",
      detail: error?.message || "INVALID_TOKEN",
    };
  }

  return { ok: true, user: data.user, token };
}
