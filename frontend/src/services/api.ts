import type {
  JobCreate,
  JobResponse,
  ProjectCreate,
  ProjectResponse,
  ProjectUpdate,
  UploadResponse,
  VideoInfo,
} from "../types/api";

const BASE = import.meta.env.VITE_API_URL ?? "";
const API = `${BASE}/api`;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function uploadVideo(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResponse>(`${API}/upload`, { method: "POST", body: form });
}

export async function createJob(job: JobCreate): Promise<JobResponse> {
  return request<JobResponse>(`${API}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
}

export async function getJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`${API}/jobs/${jobId}`);
}

export async function getVideoInfo(videoId: string): Promise<VideoInfo> {
  return request<VideoInfo>(`${API}/videos/${videoId}/info`);
}

export function getThumbnailUrl(videoId: string, t = 1): string {
  return `${API}/videos/${videoId}/thumbnail?t=${t}`;
}

export function getDownloadUrl(jobId: string, fileIndex = 0): string {
  return `${API}/download/${jobId}/${fileIndex}`;
}

export function getVideoStreamUrl(videoId: string): string {
  return `${API}/videos/${videoId}/stream`;
}

// --- Projects ---

export async function createProject(project: ProjectCreate): Promise<ProjectResponse> {
  return request<ProjectResponse>(`${API}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
}

export async function listProjects(): Promise<ProjectResponse[]> {
  return request<ProjectResponse[]>(`${API}/projects`);
}

export async function getProject(projectId: string): Promise<ProjectResponse> {
  return request<ProjectResponse>(`${API}/projects/${projectId}`);
}

export async function updateProject(projectId: string, data: ProjectUpdate): Promise<ProjectResponse> {
  return request<ProjectResponse>(`${API}/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await request<{ ok: boolean }>(`${API}/projects/${projectId}`, { method: "DELETE" });
}

export function createProgressSocket(jobId: string): WebSocket {
  const wsBase = BASE
    ? BASE.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  return new WebSocket(`${wsBase}/api/ws/jobs/${jobId}/progress`);
}
