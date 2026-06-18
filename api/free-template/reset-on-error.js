// api/free-template/reset-on-error.js
// Cuando EvoLink falla de verdad (poll.js ya marcó el registro como "failed"),
// borra la fila en free_video_uses para que el usuario pueda reintentar su
// video gratis en lugar de quedar bloqueado para siempre por un error externo.
import { supabaseAdmin }          from "../../src/lib/supabaseAdmin.js";
import { getUserIdFromAuthHeader } from "../../src/lib/getUserIdFromAuth.js";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin",  "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("content-type",                 "application/json; charset=utf-8");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const userId = await getUserIdFromAuthHeader(req);
  if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const { taskId } = body;
  if (!taskId) return res.status(400).json({ ok: false, error: "Missing taskId" });

  const { data: job, error: fetchErr } = await supabaseAdmin
    .from("free_video_uses")
    .select("id, status")
    .eq("user_id", userId)
    .eq("task_id", taskId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ ok: false, error: fetchErr.message });
  if (!job) return res.status(404).json({ ok: false, error: "Registro no encontrado" });

  if (job.status !== "failed") {
    return res.status(400).json({ ok: false, error: "Solo se puede resetear un video que falló realmente en EvoLink." });
  }

  const { error: delErr } = await supabaseAdmin
    .from("free_video_uses")
    .delete()
    .eq("id", job.id);

  if (delErr) return res.status(500).json({ ok: false, error: delErr.message });

  console.log(`[free-template/reset-on-error] reset for user=${userId} taskId=${taskId}`);
  return res.status(200).json({ ok: true, reset: true });
}

export const config = { runtime: "nodejs" };
