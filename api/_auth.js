
// ============================================================
// Auth helper (Supabase Admin) para APIs.
// Soporta:
// - Edge runtime (req.headers.get)
// - Node runtime (req.headers.authorization)
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sbAdmin() {
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
auth: { persistSession: false },
});
}

// Lee header compatible con Edge y Node
function getHeader(req, name) {
// Edge: Headers
if (req?.headers && typeof req.headers.get === "function") {
return req.headers.get(name) || req.headers.get(name.toLowerCase()) || "";
}
// Node: plain object
const h = req?.headers || {};
return h[name] || h[name.toLowerCase()] || "";
}

export async function requireUser(req) {
try {
const authHeader = getHeader(req, "authorization");

const token =  
  typeof authHeader === "string" && authHeader.startsWith("Bearer ")  
    ? authHeader.slice(7).trim()  
    : null;  

if (!token) return { ok: false, code: 401, error: "MISSING_AUTH_TOKEN" };  

const sb = sbAdmin();  
const { data, error } = await sb.auth.getUser(token);  

if (error || !data?.user) {  
  return { ok: false, code: 401, error: "INVALID_AUTH_TOKEN" };  
}  

return { ok: true, user: data.user, sb };

} catch (e) {
console.error("[AUTH] requireUser crashed:", e);
return { ok: false, code: 500, error: "AUTH_INTERNAL_ERROR" };
}
}
Y supabase_admin // lib/supabaseAdmin.js
import { createClient } from "@supabase/supabase-js";

export function sbAdmin() {
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) throw new Error("Missing SUPABASE_URL (o VITE_SUPABASE_URL)");
if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
return createClient(url, key);
}