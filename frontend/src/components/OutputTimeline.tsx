import { useCallback, useEffect, useRef, useState } from "react";
import type { Clip, ProjectVideo } from "../types/api";
import { colorForVideo } from "../utils/videoColors";

function findVideoIndex(videos: ProjectVideo[], videoId: string): number {
  return videos.findIndex((v) => v.video_id === videoId);
}

function findSegmentIndex(videos: ProjectVideo[], clip: Clip): number {
  const video = videos.find((v) => v.video_id === clip.video_id);
  if (!video) return -1;
  return video.segments.findIndex((s) => s.start === clip.start && s.end === clip.end);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(0).padStart(2, "0")}`;
}

interface Props {
  clips: Clip[];
  videos: ProjectVideo[];
  playingIndex: number | null;
  focusedIndex: number | null;
  currentTime: number;
  photoPlayback: { startTime: number; duration: number } | null;
  activeVideoId: string | null;
  onReorder: (clips: Clip[]) => void;
  onSeek: (clipIndex: number, time: number) => void;
  onPreview: (clipIndex: number) => void;
  onRemove: (clipIndex: number) => void;
  onPlayAll: () => void;
  onStop: () => void;
  onDragStart?: () => void;
  onClipDurationChange?: (clipIndex: number, newDuration: number) => void;
}

export function OutputTimeline({ clips, videos, playingIndex, focusedIndex, currentTime, photoPlayback, activeVideoId, onReorder, onSeek, onPreview, onRemove, onPlayAll, onStop, onDragStart, onClipDurationChange }: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNodeRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const photoRafRef = useRef<number>(0);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const totalDuration = clips.reduce((sum, c) => sum + (c.end - c.start), 0);

  const computePlayheadPct = useCallback((): number | null => {
    if (totalDuration <= 0) return null;
    const targetIdx = playingIndex ?? focusedIndex;
    if (targetIdx === null) return null;
    const clip = clips[targetIdx];
    if (!clip) return null;

    const isPhoto = clip.photo_duration != null;
    const clipDur = clip.end - clip.start;
    let priorDur = 0;
    for (let i = 0; i < targetIdx; i++) priorDur += clips[i].end - clips[i].start;

    if (isPhoto) {
      if (photoPlayback) {
        const elapsed = Math.min((performance.now() - photoPlayback.startTime) / 1000, photoPlayback.duration);
        return ((priorDur + Math.max(0, Math.min(elapsed, clipDur))) / totalDuration) * 100;
      }
      return (priorDur / totalDuration) * 100;
    }
    if (activeVideoId && clip.video_id === activeVideoId && currentTime >= clip.start - 0.1 && currentTime <= clip.end + 0.1) {
      return ((priorDur + Math.max(0, Math.min(currentTime - clip.start, clipDur))) / totalDuration) * 100;
    }
    return null;
  }, [clips, totalDuration, playingIndex, focusedIndex, photoPlayback, activeVideoId, currentTime]);

  useEffect(() => {
    if (!photoPlayback) {
      cancelAnimationFrame(photoRafRef.current);
      photoRafRef.current = 0;
      if (playheadRef.current) {
        const pct = computePlayheadPct();
        if (pct !== null) {
          playheadRef.current.style.left = `${pct}%`;
          playheadRef.current.style.display = "";
        } else {
          playheadRef.current.style.display = "none";
        }
      }
      return;
    }

    const tick = () => {
      if (playheadRef.current) {
        const pct = computePlayheadPct();
        if (pct !== null) {
          playheadRef.current.style.left = `${pct}%`;
          playheadRef.current.style.display = "";
        } else {
          playheadRef.current.style.display = "none";
        }
      }
      photoRafRef.current = requestAnimationFrame(tick);
    };
    photoRafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(photoRafRef.current);
      photoRafRef.current = 0;
    };
  }, [photoPlayback, computePlayheadPct]);

  let playheadPct: number | null = computePlayheadPct();

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, idx: number) => {
    onDragStart?.();
    setDragIndex(idx);
    dragNodeRef.current = e.currentTarget as HTMLDivElement;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    requestAnimationFrame(() => {
      dragNodeRef.current?.classList.add("ot-dragging");
    });
  }, [onDragStart]);

  const handleDragEnd = useCallback(() => {
    dragNodeRef.current?.classList.remove("ot-dragging");
    setDragIndex(null);
    setOverIndex(null);
    dragNodeRef.current = null;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIndex(idx);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, dropIdx: number) => {
    e.preventDefault();
    const fromIdx = dragIndex;
    if (fromIdx === null || fromIdx === dropIdx) {
      handleDragEnd();
      return;
    }
    const updated = [...clips];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(dropIdx, 0, moved);
    onReorder(updated);
    handleDragEnd();
  }, [clips, dragIndex, onReorder, handleDragEnd]);

  const isPlaying = playingIndex !== null;

  if (clips.length === 0) {
    return (
      <div className="output-timeline">
        <div className="ot-header">
          <h3>Output Timeline</h3>
        </div>
        <div className="ot-empty">Add segments from the per-video timeline above</div>
      </div>
    );
  }

  return (
    <div className="output-timeline">
      <div className="ot-header">
        <h3>Output Timeline ({clips.length} clip{clips.length !== 1 ? "s" : ""} &middot; {formatDuration(totalDuration)})</h3>
        <button
          className={`ot-play-btn${isPlaying ? " ot-playing" : ""}`}
          onClick={isPlaying ? onStop : onPlayAll}
          title={isPlaying ? "Stop playback" : "Play all clips"}
        >
          {isPlaying ? "■ Stop" : "▶ Play All"}
        </button>
      </div>
      <div className={`ot-track${isPlaying ? " ot-playing-all" : ""}`}>
        {clips.map((clip, idx) => {
          const dur = clip.end - clip.start;
          const widthPct = totalDuration > 0 ? (dur / totalDuration) * 100 : 0;
          const vi = findVideoIndex(videos, clip.video_id);
          const si = findSegmentIndex(videos, clip);
          const bg = colorForVideo(vi);
          const isOver = overIndex === idx && dragIndex !== idx;
          const isActive = playingIndex === idx || focusedIndex === idx;
          const isPhoto = clip.photo_duration != null;
          const label = isPhoto ? `#${vi + 1}` : si >= 0 ? `#${vi + 1}.${si + 1}` : `#${vi + 1}`;

          return (
            <div
              key={`${clip.video_id}-${clip.start}-${clip.end}-${idx}`}
              className={`ot-clip${isOver ? " ot-drop-target" : ""}${isActive ? " ot-active" : ""}${isPhoto ? " ot-photo" : ""}`}
              style={{
                width: `${Math.max(widthPct, 2)}%`,
                backgroundColor: bg,
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const time = isPhoto ? ratio * dur : clip.start + ratio * dur;
                onSeek(idx, time);
              }}
              onDoubleClick={() => {
                onPreview(idx);
              }}
              title={isPhoto
                ? `${label} IMG · ${formatDuration(dur)} · click to seek, double-click to play`
                : `${label} · ${formatDuration(dur)} · click to seek, double-click to preview`}
            >
              {isPhoto && <span className="ot-clip-badge">IMG</span>}
              <span className="ot-clip-label">{label}</span>
              {widthPct > 8 && editingIdx === idx ? (
                <input
                  className="ot-dur-input"
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={editValue}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => {
                    const v = parseFloat(editValue);
                    if (v > 0 && onClipDurationChange) onClipDurationChange(idx, v);
                    setEditingIdx(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = parseFloat(editValue);
                      if (v > 0 && onClipDurationChange) onClipDurationChange(idx, v);
                      setEditingIdx(null);
                    } else if (e.key === "Escape") {
                      setEditingIdx(null);
                    }
                  }}
                />
              ) : widthPct > 8 ? (
                <span
                  className="ot-clip-dur"
                  onDoubleClick={isPhoto ? (e) => {
                    e.stopPropagation();
                    setEditingIdx(idx);
                    setEditValue(String(dur));
                  } : undefined}
                  title={isPhoto ? "Double-click to edit duration" : undefined}
                  style={isPhoto ? { cursor: "text" } : undefined}
                >
                  {formatDuration(dur)}
                </span>
              ) : null}
              <button
                className="ot-clip-remove"
                onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
              >
                ×
              </button>
            </div>
          );
        })}
        <div
          ref={playheadRef}
          className="ot-playhead"
          style={{
            left: playheadPct !== null ? `${playheadPct}%` : "0%",
            display: playheadPct !== null ? "" : "none",
          }}
        />
      </div>
    </div>
  );
}
