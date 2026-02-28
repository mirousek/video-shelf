import { useCallback, useRef, useState, type DragEvent } from "react";

interface UploadProgress {
  name: string;
  done: boolean;
  error?: string;
}

interface Props {
  onFiles: (files: File[]) => void;
  loading: boolean;
  progress: UploadProgress[];
}

export type { UploadProgress };

export function UploadZone({ onFiles, loading, progress }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type.startsWith("video/") || f.type.startsWith("image/"),
      );
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );

  return (
    <div
      className={`upload-zone ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !loading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
      {loading ? (
        <div className="upload-progress-list">
          <div className="spinner" />
          <p>Uploading {progress.length} file{progress.length !== 1 ? "s" : ""}...</p>
          {progress.map((p, i) => (
            <div key={i} className={`upload-progress-item ${p.done ? "done" : ""} ${p.error ? "error" : ""}`}>
              <span className="upload-progress-name">{p.name}</span>
              <span className="upload-progress-status">
                {p.error ? p.error : p.done ? "Done" : "Uploading..."}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="upload-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="upload-text">Drop video or image files here or click to browse</p>
          <p className="upload-hint">MP4, MKV, AVI, MOV, WebM, JPG, PNG, WebP supported — multiple files OK</p>
        </>
      )}
    </div>
  );
}
