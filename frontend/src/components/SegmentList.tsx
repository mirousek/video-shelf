import type { Clip, CutSegment, ProjectVideo } from "../types/api";
import { colorForVideo } from "../utils/videoColors";

interface Props {
  videos: ProjectVideo[];
  activeIndex: number;
  outputTimeline: Clip[];
  highlightVi: number | null;
  highlightSi: number | null;
  onSelect: (videoIndex: number) => void;
  onRemove: (videoIndex: number, segIndex: number) => void;
  onUpdate: (videoIndex: number, segIndex: number, segment: CutSegment, edge?: "start" | "end") => void;
  onPreview: (videoIndex: number, segIndex: number) => void;
  onAddToTimeline: (videoIndex: number, segIndex: number) => void;
}

export function SegmentList({ videos, activeIndex, outputTimeline, highlightVi, highlightSi, onSelect, onRemove, onUpdate, onPreview, onAddToTimeline }: Props) {
  const totalSegments = videos.reduce((sum, v) => sum + v.segments.length, 0);

  if (totalSegments === 0) {
    return <p className="empty-state">No segments yet. Double-click the timeline to add one.</p>;
  }

  return (
    <div className="segment-list">
      <h3>All Clips ({totalSegments})</h3>
      {videos.map((v, vi) =>
        v.segments.map((seg, si) => (
          <div
            key={`${vi}-${si}`}
            className={`segment-item${vi === activeIndex ? " active-video" : ""}${vi === highlightVi && si === highlightSi ? " segment-playing" : ""}`}
            style={{
              borderLeft: `3px solid ${colorForVideo(vi)}`,
              background: `${colorForVideo(vi)}15`,
            }}
            onClick={() => onSelect(vi)}
          >
            <span
              className="segment-video-label"
              title={`#${vi + 1}.${si + 1} ${v.video_info.filename}`}
              style={{ color: colorForVideo(vi), background: `${colorForVideo(vi)}25` }}
            >
              #{vi + 1}.{si + 1}
            </span>
            <label>
              Start
              <input
                type="number"
                step="0.1"
                min="0"
                value={seg.start.toFixed(1)}
                onChange={(e) =>
                  onUpdate(vi, si, { ...seg, start: Math.max(0, parseFloat(e.target.value) || 0) }, "start")
                }
              />
            </label>
            <label>
              End
              <input
                type="number"
                step="0.1"
                min="0"
                value={seg.end.toFixed(1)}
                onChange={(e) =>
                  onUpdate(vi, si, {
                    ...seg,
                    end: Math.max(seg.start + 0.1, parseFloat(e.target.value) || 0),
                  }, "end")
                }
              />
            </label>
            <span className="segment-duration">{(seg.end - seg.start).toFixed(1)}s</span>
            <button
              className="btn-add-to-timeline btn-small"
              title="Add to output timeline"
              onClick={(e) => { e.stopPropagation(); onAddToTimeline(vi, si); }}
            >
              +
            </button>
            <button
              className="btn-preview btn-small"
              title="Preview segment"
              onClick={(e) => { e.stopPropagation(); onPreview(vi, si); }}
            >
              ▶
            </button>
            <button className="btn-danger btn-small" onClick={(e) => { e.stopPropagation(); onRemove(vi, si); }}>
              Remove
            </button>
          </div>
        )),
      )}
    </div>
  );
}
