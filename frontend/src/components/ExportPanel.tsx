import { useState } from "react";
import { createJob, getDownloadUrl } from "../services/api";
import { useJobProgress } from "../hooks/useJobProgress";
import type { Clip, ProjectVideo } from "../types/api";

interface Props {
  videos: ProjectVideo[];
  outputTimeline: Clip[];
}

const QUALITY_PRESETS = [
  { label: "Low", crf: 28, preset: "fast", hint: "Smallest file, fastest" },
  { label: "Medium", crf: 23, preset: "medium", hint: "" },
  { label: "Good", crf: 18, preset: "medium", hint: "Recommended" },
  { label: "High", crf: 14, preset: "slow", hint: "" },
  { label: "Best", crf: 10, preset: "slower", hint: "Closest to original" },
] as const;

export function ExportPanel({ videos, outputTimeline }: Props) {
  const [format, setFormat] = useState("mp4");
  const [concat, setConcat] = useState(true);
  const [qualityIdx, setQualityIdx] = useState(2);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { status, progress, job } = useJobProgress(jobId);

  const allClips: Clip[] = outputTimeline.length > 0
    ? outputTimeline
    : videos.flatMap((v) =>
        v.segments.map((s) => ({ video_id: v.video_id, start: s.start, end: s.end })),
      );

  const handleExport = async () => {
    if (allClips.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await createJob({
        clips: allClips,
        output_format: format,
        concat,
        crf: QUALITY_PRESETS[qualityIdx].crf,
        preset: QUALITY_PRESETS[qualityIdx].preset,
      });
      setJobId(res.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isProcessing = jobId && (status === "pending" || status === "processing");

  return (
    <div className="export-panel">
      <h3>Export ({allClips.length} clip{allClips.length !== 1 ? "s" : ""})</h3>

      <div className="export-options">
        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="mp4">MP4</option>
            <option value="mkv">MKV</option>
            <option value="webm">WebM</option>
            <option value="mov">MOV</option>
          </select>
        </label>

        <label>
          Quality: {QUALITY_PRESETS[qualityIdx].label}
          {QUALITY_PRESETS[qualityIdx].hint && (
            <span className="quality-hint"> ({QUALITY_PRESETS[qualityIdx].hint})</span>
          )}
          <input
            type="range"
            min={0}
            max={QUALITY_PRESETS.length - 1}
            value={qualityIdx}
            onChange={(e) => setQualityIdx(Number(e.target.value))}
            className="quality-slider"
          />
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={concat}
            onChange={(e) => setConcat(e.target.checked)}
          />
          Concatenate all clips into one file
        </label>
      </div>

      <button
        className="btn-primary"
        onClick={handleExport}
        disabled={allClips.length === 0 || submitting || !!isProcessing}
      >
        {submitting ? "Submitting..." : isProcessing ? "Processing..." : "Export All"}
      </button>

      {error && <p className="error-text">{error}</p>}

      {jobId && (
        <div className="job-status">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="progress-label">
            {status === "completed"
              ? "Done!"
              : status === "failed"
                ? "Failed"
                : `${Math.round(progress * 100)}%`}
          </span>

          {status === "completed" && job && (
            <div className="download-links">
              {job.output_files.map((_, i) => (
                <a
                  key={i}
                  href={getDownloadUrl(jobId, i)}
                  className="btn-secondary"
                  download
                >
                  Download {job.output_files.length > 1 ? `#${i + 1}` : ""}
                </a>
              ))}
            </div>
          )}

          {status === "failed" && job?.error && (
            <p className="error-text">{job.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
