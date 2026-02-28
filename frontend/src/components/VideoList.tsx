import { useRef } from "react";
import { getThumbnailUrl, getVideoStreamUrl } from "../services/api";
import type { ProjectVideo } from "../types/api";
import { colorForVideo } from "../utils/videoColors";

interface Props {
  videos: ProjectVideo[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onAddFiles: (files: File[]) => void;
  onAddPhotoToTimeline: (videoIndex: number) => void;
  uploading: boolean;
}

export function VideoList({ videos, activeIndex, onSelect, onRemove, onAddFiles, onAddPhotoToTimeline, uploading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="video-list">
      <div className="video-list-header">
        <h3>Media ({videos.length})</h3>
        <button
          className="btn-secondary btn-small"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Adding..." : "+ Add"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onAddFiles(files);
            e.target.value = "";
          }}
        />
      </div>
      <div className="video-list-items">
        {videos.map((v, i) => {
          const isImage = v.video_info.media_type === "image";
          return (
            <div
              key={v.video_id}
              className={`video-list-item ${i === activeIndex ? "active" : ""}`}
              style={{ background: i === activeIndex ? `${colorForVideo(i)}45` : `${colorForVideo(i)}20` }}
              onClick={() => onSelect(i)}
            >
              <div className="video-list-thumb">
                {isImage ? (
                  <img
                    src={getVideoStreamUrl(v.video_id)}
                    alt={v.video_info.filename}
                  />
                ) : (
                  <img
                    src={getThumbnailUrl(v.video_id)}
                    alt={v.video_info.filename}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                {isImage && <span className="media-badge media-badge-img">IMG</span>}
              </div>
              <div className="video-list-info">
                <span className="video-list-name"><span className="video-number">#{i + 1}</span> {v.video_info.filename}</span>
                <span className="video-list-meta">
                  {isImage
                    ? `${v.video_info.width}×${v.video_info.height}`
                    : `${v.segments.length} seg · ${v.video_info.duration.toFixed(1)}s`}
                </span>
              </div>
              <div className="video-list-actions">
                {isImage && (
                  <button
                    className="btn-add-to-timeline btn-small"
                    title="Add to output timeline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddPhotoToTimeline(i);
                    }}
                  >
                    +
                  </button>
                )}
                {videos.length > 1 && (
                  <button
                    className="video-list-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(i);
                    }}
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
