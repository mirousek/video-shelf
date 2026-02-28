import { useCallback, useRef, useState, type MouseEvent } from "react";
import type { CutSegment } from "../types/api";
import { colorForVideo } from "../utils/videoColors";

interface Props {
  duration: number;
  currentTime: number;
  segments: CutSegment[];
  videoIndex: number;
  highlightSegIndex: number | null;
  onSeek: (time: number) => void;
  onSegmentAdd: (segment: CutSegment) => void;
  onSegmentRemove: (index: number) => void;
  onSegmentUpdate: (index: number, segment: CutSegment, edge?: "start" | "end") => void;
  onResizeStart?: (index: number) => void;
  onResizeEnd?: (index: number) => void;
}

export function Timeline({
  duration,
  currentTime,
  segments,
  videoIndex,
  highlightSegIndex,
  onSeek,
  onSegmentAdd,
  onSegmentRemove,
  onSegmentUpdate,
  onResizeStart,
  onResizeEnd,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    type: "creating" | "resizing-start" | "resizing-end";
    segmentIndex?: number;
    startX: number;
    startTime: number;
  } | null>(null);

  const posToTime = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !duration) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const scrubRef = useRef(false);

  const handleTrackClick = (e: MouseEvent) => {
    if (dragState) return;
    const time = posToTime(e.clientX);
    onSeek(time);
  };

  const handleTrackMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".segment-handle")) return;
    scrubRef.current = true;

    const onMove = (me: globalThis.MouseEvent) => {
      if (!scrubRef.current) return;
      const time = posToTime(me.clientX);
      onSeek(time);
    };

    const onUp = () => {
      scrubRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleTrackDoubleClick = (e: MouseEvent) => {
    const time = posToTime(e.clientX);
    const segLen = Math.min(5, duration - time);
    if (segLen > 0.1) {
      onSegmentAdd({ start: time, end: time + segLen });
    }
  };

  const handleResizeStart = (e: MouseEvent, index: number, edge: "start" | "end") => {
    e.stopPropagation();
    onResizeStart?.(index);
    setDragState({
      type: edge === "start" ? "resizing-start" : "resizing-end",
      segmentIndex: index,
      startX: e.clientX,
      startTime: posToTime(e.clientX),
    });

    const onMove = (me: globalThis.MouseEvent) => {
      const time = posToTime(me.clientX);
      const seg = { ...segments[index] };

      if (edge === "start") {
        seg.start = Math.max(0, Math.min(time, seg.end - 0.1));
      } else {
        seg.end = Math.min(duration, Math.max(time, seg.start + 0.1));
      }
      onSegmentUpdate(index, seg, edge);
    };

    const onUp = () => {
      setDragState(null);
      onResizeEnd?.(index);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const playheadPos = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="timeline">
      <div className="timeline-ruler">
        {Array.from({ length: Math.ceil(duration / 10) + 1 }, (_, i) => {
          const t = i * 10;
          if (t > duration) return null;
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
      <div
        ref={trackRef}
        className="timeline-track"
        onMouseDown={handleTrackMouseDown}
        onClick={handleTrackClick}
        onDoubleClick={handleTrackDoubleClick}
      >
        {segments.map((seg, i) => {
          const left = (seg.start / duration) * 100;
          const width = ((seg.end - seg.start) / duration) * 100;
          const color = colorForVideo(videoIndex);
          return (
            <div
              key={i}
              className={`segment${i === highlightSegIndex ? " segment-playing" : ""}`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: `${color}40`,
                borderColor: color,
              }}
            >
              <div
                className="segment-handle left"
                onMouseDown={(e) => handleResizeStart(e, i, "start")}
              />
              <span className="segment-label">
                #{videoIndex + 1}.{i + 1} {formatRuler(seg.start)} - {formatRuler(seg.end)}
              </span>
              <button
                className="segment-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onSegmentRemove(i);
                }}
              >
                ×
              </button>
              <div
                className="segment-handle right"
                onMouseDown={(e) => handleResizeStart(e, i, "end")}
              />
            </div>
          );
        })}
        <div className="playhead" style={{ left: `${playheadPos}%` }} />
      </div>
      <p className="timeline-hint">Click to seek. Double-click to add a 5s segment.</p>
    </div>
  );
}

function formatRuler(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
