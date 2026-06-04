import { useEffect, useState } from 'react';
import { api, type ArtifactShape, type Project } from '../api.js';
import { formatFullTime, projectLabel } from '../sessionDisplay.js';

interface Props {
  id: string;
  onBack: () => void;
}

function shapeDetail(shape: ArtifactShape): string {
  if (shape.detector.kind === 'folder-leaf' || shape.detector.kind === 'file-glob') {
    return shape.detector.include.join(', ');
  }
  return shape.detector.kind === 'branch' ? 'branch / plan thread' : 'entire project surface';
}

export function ProjectView({ id, onBack }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [redirectedFrom, setRedirectedFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () => {
    api
      .getProject(id)
      .then((result) => {
        setProject(result.project);
        setRedirectedFrom(result.redirectedFrom);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(refresh, [id]);

  const command = `Read superdense/reward/profile.md for project ${project?.id ?? id}`;
  const copyCommand = async () => {
    await navigator.clipboard.writeText(command);
    setToast('Profiling instruction copied. Paste it into Claude Code or Codex.');
    setTimeout(() => setToast(null), 4000);
  };

  const toggleAttention = async () => {
    if (!project) return;
    try {
      const result = await api.setProjectAttention(
        project.id,
        !project.needsHumanAttention,
        project.needsHumanAttention ? undefined : ['Marked for human attention in Studio'],
      );
      setProject(result.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error)
    return (
      <div className="work-body">
        <div className="error">Failed to load: {error}</div>
      </div>
    );
  if (!project) return <div className="empty">Loading...</div>;

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <div className="work-heading">
          <div className="work-title">{project.name ?? projectLabel(project.projectKey)}</div>
          <div className="work-sub">{project.projectKey}</div>
        </div>
      </div>
      <div className="work-body project-detail">
        {redirectedFrom && (
          <div className="notice">
            This covered project record redirects to its canonical profile.
          </div>
        )}
        <section className="card">
          <div className="project-detail-actions">
            <div>
              <div className="card-title">Profile status</div>
              <div
                className={`project-status ${project.status === 'unprofiled' || project.needsHumanAttention ? 'attention' : ''}`}
              >
                {project.status === 'unprofiled'
                  ? 'needs profiling'
                  : project.needsHumanAttention
                    ? 'needs attention'
                    : 'profiled'}
              </div>
            </div>
            <div className="button-row">
              <button className="copy-btn" onClick={copyCommand}>
                Copy profiling instruction
              </button>
              <button className="copy-btn" onClick={toggleAttention}>
                {project.needsHumanAttention ? 'Resolve attention' : 'Mark for attention'}
              </button>
            </div>
          </div>
          <pre className="command-box">{command}</pre>
          {project.description && <p>{project.description}</p>}
          <div className="muted small">
            First seen {formatFullTime(project.firstSeenAt)} · Last seen{' '}
            {formatFullTime(project.lastSeenAt)}
          </div>
        </section>

        <section className="card">
          <div className="card-title">Roots and covered records</div>
          {project.roots.length === 0 ? (
            <div className="muted">No canonical roots stored yet.</div>
          ) : (
            <ul className="plain-list">
              {project.roots.map((root) => (
                <li key={root} className="mono">
                  {root}
                </li>
              ))}
            </ul>
          )}
          {project.coveredProjects.length > 0 && (
            <>
              <div className="card-subtitle spaced">Covered detected records</div>
              <ul className="plain-list">
                {project.coveredProjects.map((covered) => (
                  <li key={covered.id} className="mono">
                    {covered.projectKey}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <div className="card-title">Artifact shapes</div>
          {project.artifactShapes.length === 0 ? (
            <div className="muted">No local artifact shapes stored.</div>
          ) : (
            <ul className="plain-list">
              {project.artifactShapes.map((shape, index) => (
                <li key={`${shape.type}-${index}`}>
                  <strong>{shape.type}</strong> ·{' '}
                  <span className="mono">{shape.detector.kind}</span> · {shapeDetail(shape)}
                  {shape.outputHint && (
                    <div className="muted small">
                      Output hint: {shape.outputHint.globs.join(', ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-title">Evidence and notes</div>
          {project.evidenceSummary.length === 0 ? (
            <div className="muted">No profiling evidence summary stored.</div>
          ) : (
            <ul className="plain-list">
              {project.evidenceSummary.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          {project.notes && <p>{project.notes}</p>}
          {project.attentionReasons.length > 0 && (
            <>
              <div className="card-subtitle spaced">Human attention reasons</div>
              <ul className="plain-list">
                {project.attentionReasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}
