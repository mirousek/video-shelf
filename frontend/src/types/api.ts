export interface VideoInfo {
  filename: string;
  duration: number;
  width: number;
  height: number;
  codec: string;
  fps: number;
  size_bytes: number;
  media_type: "video" | "image";
}

export interface UploadResponse {
  video_id: string;
  info: VideoInfo;
}

export interface CutSegment {
  id: string;
  start: number;
  end: number;
}

export interface Clip {
  video_id: string;
  start: number;
  end: number;
  photo_duration?: number;
  segment_id?: string | null;
}

export interface JobCreate {
  clips: Clip[];
  output_format: string;
  concat: boolean;
  crf?: number;
  preset?: string;
}

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobResponse {
  id: string;
  status: JobStatus;
  progress: number;
  output_files: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectVideo {
  video_id: string;
  video_info: VideoInfo;
  segments: CutSegment[];
}

export interface ProjectCreate {
  name: string;
  videos: ProjectVideo[];
  output_timeline?: Clip[];
}

export interface ProjectUpdate {
  name?: string;
  videos?: ProjectVideo[];
  output_timeline?: Clip[];
}

export interface ProjectResponse {
  id: string;
  name: string;
  videos: ProjectVideo[];
  output_timeline: Clip[];
  created_at: string;
  updated_at: string;
}
