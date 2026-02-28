import { useEffect, useState } from "react";
import { deleteProject, getThumbnailUrl, listProjects } from "../services/api";
import type { ProjectResponse } from "../types/api";

interface Props {
  onOpen: (project: ProjectResponse) => void;
  onNew: () => void;
  refreshKey: number;
}

export function ProjectList({ onOpen, onNew, refreshKey }: Props) {
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listProjects()
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete this project?")) return;
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="project-list-loading">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="project-list-view">
      <div className="project-list-header">
        <h2>Projects</h2>
        <button className="btn-primary btn-new-project" onClick={onNew}>
          + New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="project-list-empty">
          <p>No projects yet. Upload a video to get started.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const firstVideo = p.videos[0];
            const totalSegments = p.videos.reduce((sum, v) => sum + v.segments.length, 0);
            return (
              <div key={p.id} className="project-card" onClick={() => onOpen(p)}>
                <div className="project-thumb">
                  {firstVideo && (
                    <img
                      src={getThumbnailUrl(firstVideo.video_id)}
                      alt={p.name}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                </div>
                <div className="project-card-body">
                  <h3 className="project-card-name">{p.name}</h3>
                  <div className="project-card-meta">
                    <span>{p.videos.length} video{p.videos.length !== 1 ? "s" : ""}</span>
                    <span>{totalSegments} segment{totalSegments !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="project-card-footer">
                    <span className="project-card-date">{formatDate(p.updated_at)}</span>
                    <button
                      className="btn-danger btn-small"
                      onClick={(e) => handleDelete(e, p.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
