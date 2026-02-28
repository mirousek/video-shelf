import { useCallback, useEffect, useRef, useState } from "react";
import { createProgressSocket, getJob } from "../services/api";
import type { JobResponse, JobStatus } from "../types/api";

interface ProgressState {
  status: JobStatus;
  progress: number;
  job: JobResponse | null;
}

export function useJobProgress(jobId: string | null) {
  const [state, setState] = useState<ProgressState>({
    status: "pending",
    progress: 0,
    job: null,
  });
  const wsRef = useRef<WebSocket | null>(null);

  const pollFallback = useCallback(async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const job = await getJob(id);
        setState({ status: job.status, progress: job.progress, job });
        if (job.status === "completed" || job.status === "failed") {
          clearInterval(interval);
        }
      } catch {
        clearInterval(interval);
      }
    }, 1000);
    return interval;
  }, []);

  useEffect(() => {
    if (!jobId) return;

    setState({ status: "pending", progress: 0, job: null });

    let pollInterval: ReturnType<typeof setInterval> | null = null;

    try {
      const ws = createProgressSocket(jobId);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.error) {
          setState((s) => ({ ...s, status: "failed" }));
          return;
        }
        setState((s) => ({
          ...s,
          progress: data.progress ?? s.progress,
          status: data.status ?? (data.progress >= 1 ? "completed" : "processing"),
        }));
      };

      ws.onclose = () => {
        getJob(jobId).then((job) => {
          setState({ status: job.status, progress: job.progress, job });
        });
      };

      ws.onerror = () => {
        ws.close();
        pollFallback(jobId).then((id) => {
          pollInterval = id;
        });
      };
    } catch {
      pollFallback(jobId).then((id) => {
        pollInterval = id;
      });
    }

    return () => {
      wsRef.current?.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [jobId, pollFallback]);

  return state;
}
