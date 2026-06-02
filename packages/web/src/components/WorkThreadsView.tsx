import { useEffect, useMemo, useState } from 'react';
import { api, type ProjectSummary, type ThreadLifecycle, type WorkThread } from '../api.js';
import { formatRelativeTime, projectLabel } from '../sessionDisplay.js';

interface Props {
  projectId?: string;
  onProjectChange: (projectId?: string) => void;
  onOpen: (id: string) => void;
}

const sections: Array<{ lifecycle: ThreadLifecycle; title: string; empty: string }> = [
  { lifecycle: 'open', title: 'Drafts', empty: 'No draft work threads.' },
  {
    lifecycle: 'ready',
    title: 'Ready to create artifacts',
    empty: 'No work threads awaiting artifact creation.',
  },
  { lifecycle: 'artifact', title: 'Artifacts', empty: 'No extracted artifact threads.' },
];

function projectName(project: ProjectSummary | undefined, projectProfileId: string): string {
  return project?.name ?? projectLabel(project?.projectKey ?? projectProfileId);
}

function relevantTime(thread: WorkThread): number {
  return thread.artifactFinalizedAt ?? thread.readyAt ?? thread.updatedAt;
}

export function WorkThreadsView({ projectId, onProjectChange, onOpen }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [items, setItems] = useState<WorkThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then((result) => setProjects(result.items))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    setItems(null);
    api
      .listThreads({ projectId })
      .then((result) => {
        setItems(result.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [projectId]);

  const projectsById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project])),
    [projects],
  );

  const copyFinalizeCommand = async () => {
    await navigator.clipboard.writeText('/superdense-artifact-finalize');
    setToast('Artifact queue command copied. Paste it into Claude Code or Codex.');
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">Work Threads</div>
          <div className="work-sub">Mutable drafts, extraction queue, and immutable artifacts</div>
        </div>
        <label className="thread-project-filter">
          <span>Project</span>
          <select
            aria-label="Project"
            value={projectId ?? ''}
            onChange={(event) => onProjectChange(event.target.value || undefined)}
          >
            <option value="">All projects</option>
            {(projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name ?? projectLabel(project.projectKey)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="work-body">
        {error && <div className="error">Failed to load: {error}</div>}
        {!items && !error && <div className="empty">Loading...</div>}
        {items &&
          sections.map((section) => {
            const threads = items.filter((thread) => thread.lifecycle === section.lifecycle);
            return (
              <section className="thread-section" key={section.lifecycle}>
                <div className="thread-section-title">
                  <span>{section.title}</span>
                  <span className="count">{threads.length}</span>
                </div>
                {threads.length === 0 ? (
                  <div className="muted small thread-section-empty">{section.empty}</div>
                ) : (
                  threads.map((thread) => (
                    <div key={thread.id} className="project-card thread-card">
                      <button
                        className="thread-card-open"
                        type="button"
                        onClick={() => onOpen(thread.id)}
                      >
                        <div className="project-card-top">
                          <strong>{thread.provisionalTitle}</strong>
                          <span className="project-status">{thread.lifecycle}</span>
                        </div>
                        <div className="muted small">
                          {projectName(
                            projectsById.get(thread.projectProfileId),
                            thread.projectProfileId,
                          )}
                        </div>
                        {thread.summary && (
                          <div className="project-card-description">{thread.summary}</div>
                        )}
                        <div className="muted small">
                          {thread.lifecycle === 'artifact' ? 'finalized' : 'updated'}{' '}
                          {formatRelativeTime(relevantTime(thread))}
                        </div>
                      </button>
                      {thread.lifecycle === 'ready' && (
                        <button
                          className="copy-btn"
                          type="button"
                          onClick={() => copyFinalizeCommand()}
                        >
                          Copy artifact queue command
                        </button>
                      )}
                    </div>
                  ))
                )}
              </section>
            );
          })}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}
