import { useEffect, useRef } from "react";
import { updateProject } from "../services/api";
import type { Clip, ProjectVideo } from "../types/api";

export function useAutoSave(projectId: string | null, videos: ProjectVideo[], outputTimeline: Clip[]) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRef = useRef<string>("");

  useEffect(() => {
    if (!projectId) return;

    const serialized = JSON.stringify({ videos, outputTimeline });
    if (serialized === prevRef.current) return;
    prevRef.current = serialized;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      updateProject(projectId, { videos, output_timeline: outputTimeline }).catch(() => {});
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [projectId, videos, outputTimeline]);
}
