// /pages/api/pod_autosleep.js
// ------------------------------------------------------------
// IsabelaOS Studio - Pod AutoSleep (STOP ONLY)
// - Se ejecuta por Vercel Cron (cada 1 minuto)
// - Si el pod lleva > 3 minutos sin uso, lo apagamos (STOP)
// - STOP mantiene el disco y archivos (no borra entorno/modelos)
// ------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

const IDLE_LIMIT_MS = 3 * 60 * 1000; // 3 minutos

// TODO: Implementar esto con tu API real de RunPod
async function stopRunpodPod(podId) {
  // Aquí vas a llamar a RunPod para hacer STOP del pod
  // Ejemplo (pseudo):
  // await fetch("https://api.runpod.io/graphql", {...})
  // return true;
  console.log("[autosleep] stopRunpodPod TODO podId=", podId);
  return true;
}

export default async function handler(req, res) {
  try {
    // Supabase Service Role: este endpoint corre server-side
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Leer estado del pod único (id=1)
    const { data: st, error } = await supabase
      .from("pod_state")
      .select("*")
      .eq("id", 1)
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    // Si no tenemos pod_id, no hay nada que apagar
    if (!st.pod_id) {
      return res.json({ ok: true, action: "noop", reason: "no_pod_id", status: st.status });
    }

    // Calcular inactividad
    const last = st.last_used_at ? new Date(st.last_used_at).getTime() : 0;
    const idleMs = Date.now() - last;

    // Solo apagamos si está RUNNING y ya pasó el límite
    if (st.status === "RUNNING" && idleMs > IDLE_LIMIT_MS) {
      // STOP del pod (no terminate)
      const stopped = await stopRunpodPod(st.pod_id);

      if (stopped) {
        await supabase
          .from("pod_state")
          .update({
            status: "STOPPED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", 1);

        return res.json({ ok: true, action: "stopped", pod_id: st.pod_id, idle_ms: idleMs });
      }

      return res.status(500).json({ ok: false, error: "No se pudo detener el pod" });
    }

    // Si no aplica, no hacemos nada
    return res.json({
      ok: true,
      action: "noop",
      status: st.status,
      idle_ms: idleMs,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
