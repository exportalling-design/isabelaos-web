import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const KEY = "isabela_active_job"; // unifica i2v/t2v si querés
const JobTrackerCtx = createContext(null);

export function useJobTracker() {
  const v = useContext(JobTrackerCtx);
  if (!v) throw new Error("useJobTracker must be used inside <JobTrackerProvider>");
  return v;
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function fetchJobStatus(job_id) {
  // Ajustá esta URL a tu endpoint real
  const r = await fetch(`/api/video-status?job_id=${encodeURIComponent(job_id)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || "status failed");
  return data;
}

export function JobTrackerProvider({ children }) {
  const [activeJob, setActiveJob] = useState(() => {
    const raw = localStorage.getItem(KEY);
    return raw ? safeJsonParse(raw) : null;
  });

  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const pollRef = useRef(null);
  const inflightRef = useRef(false);

  const persist = (job) => {
    if (!job) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(job));
  };

  const clearJob = () => {
    setActiveJob(null);
    setStatus(null);
    setError(null);
    persist(null);
  };

  const setJob = (job) => {
    setActiveJob(job);
    setError(null);
    persist(job);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = () => {
    stopPolling();
    if (!activeJob?.job_id) return;

    pollRef.current = setInterval(async () => {
      if (inflightRef.current) return;
      inflightRef.current = true;

      try {
        const s = await fetchJobStatus(activeJob.job_id);
        setStatus(s);
        setError(null);

        // ✅ Si ya terminó, limpiamos
        const st = String(s?.status || "").toUpperCase();
        if (["COMPLETED", "DONE", "ERROR", "FAILED", "CANCELLED"].includes(st)) {
          clearJob();
        }
      } catch (e) {
        // No mates el tracker: solo guardá error y sigue intentando
        setError(e?.message || "status error");
      } finally {
        inflightRef.current = false;
      }
    }, 1500); // polling rápido; si querés baja a 2500/3000
  };

  // Arranca/actualiza polling cuando cambia activeJob
  useEffect(() => {
    startPolling();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.job_id]);

  // ✅ BONUS: cuando volvés a la pestaña, fuerza refresh inmediato
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState === "visible" && activeJob?.job_id) {
        try {
          const s = await fetchJobStatus(activeJob.job_id);
          setStatus(s);
          setError(null);
        } catch (e) {
          setError(e?.message || "status error");
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [activeJob?.job_id]);

  const value = useMemo(() => ({
    activeJob,
    status,
    error,
    setJob,
    clearJob,
  }), [activeJob, status, error]);

  return <JobTrackerCtx.Provider value={value}>{children}</JobTrackerCtx.Provider>;
}
