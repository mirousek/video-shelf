import { useEffect, useRef } from "react";
import { colorForVideo } from "../utils/videoColors";

interface Props {
  duration: number;
  videoIndex: number;
  active: boolean;
  photoPlayback: { startTime: number; duration: number } | null;
}

export function ImageTimeline({ duration, videoIndex, active, photoPlayback }: Props) {
  const playheadRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const el = playheadRef.current;
    if (!el) return;

    if (!photoPlayback) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      el.style.display = "none";
      return;
    }

    const tick = () => {
      const elapsed = (performance.now() - photoPlayback.startTime) / 1000;
      const pct = Math.min(elapsed / photoPlayback.duration, 1) * 100;
      el.style.left = `${pct}%`;
      el.style.display = "";
      if (elapsed < photoPlayback.duration) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [photoPlayback]);

  const color = colorForVideo(videoIndex);
  const rulerStep = duration <= 5 ? 1 : duration <= 30 ? 5 : 10;
  const marks = Math.floor(duration / rulerStep) + 1;

  return (
    <div className="timeline">
      <div className="timeline-ruler">
        {Array.from({ length: marks }, (_, i) => {
          const t = i * rulerStep;
          return (
            <span
              key={i}
              className="ruler-mark"
              style={{ left: `${(t / duration) * 100}%` }}
            >
              {formatRuler(t)}
            </span>
          );
        })}
      </div>
      <div className="timeline-track image-timeline-track">
        <div
          className={`image-timeline-fill${active ? " image-timeline-active" : ""}`}
          style={{
            backgroundColor: `${color}40`,
            borderColor: color,
          }}
        />
        <div ref={playheadRef} className="playhead" style={{ display: "none" }} />
      </div>
      <p className="timeline-hint">Photo · {duration.toFixed(1)}s</p>
    </div>
  );
}

function formatRuler(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
