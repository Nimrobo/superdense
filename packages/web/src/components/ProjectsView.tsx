import { useEffect, useState } from 'react';
import { api, type ProjectSummary } from '../api.js';
import { formatRelativeTime, projectLabel } from '../sessionDisplay.js';

interface Props {
  onOpen: (id: string) => void;
}

function statusLabel(project: ProjectSummary): string {
  if (project.status === 'unprofiled') return 'needs profiling';
  if (project.needsHumanAttention) return 'needs attention';
  return 'profiled';
}

export function ProjectsView({ onOpen }: Props) {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then((result) => setItems(result.items))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">Projects</div>
          <div className="work-sub">Local project profiles for artifact discovery</div>
        </div>
      </div>
      <div className="work-body">
        {error && <div className="error">Failed to load: {error}</div>}
        {!items && !error && <div className="empty">Loading...</div>}
        {items?.length === 0 && <div className="empty">No indexed projects yet.</div>}
        {items?.map((project) => (
          <button
            key={project.id}
            type="button"
            className="project-card"
            onClick={() => onOpen(project.id)}
          >
            <div className="project-card-top">
              <strong>{project.name ?? projectLabel(project.projectKey)}</strong>
              <span
                className={`project-status ${project.status === 'unprofiled' || project.needsHumanAttention ? 'attention' : ''}`}
              >
                {statusLabel(project)}
              </span>
            </div>
            <div className="muted small ellipsis">{project.projectKey}</div>
            {project.description && (
              <div className="project-card-description">{project.description}</div>
            )}
            <div className="muted small">seen {formatRelativeTime(project.lastSeenAt)}</div>
          </button>
        ))}
      </div>
    </>
  );
}
