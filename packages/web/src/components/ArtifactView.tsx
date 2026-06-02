import { useEffect, useState } from 'react';
import { api, type Artifact } from '../api.js';
import { formatFullTime } from '../sessionDisplay.js';

interface Props {
  id: string;
  onBack: () => void;
  onOpenSession: (id: string) => void;
}

export function ArtifactView({ id, onBack, onOpenSession }: Props) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getArtifact(id)
      .then((result) => {
        setArtifact(result.artifact);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (error)
    return (
      <div className="work-body">
        <div className="error">Failed to load: {error}</div>
      </div>
    );
  if (!artifact) return <div className="empty">Loading...</div>;

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <div className="work-heading">
          <div className="work-title">{artifact.provisionalTitle}</div>
          <div className="work-sub">{artifact.artifactType}</div>
        </div>
      </div>
      <div className="work-body project-detail">
        <section className="card">
          <div className="card-title">Artifact</div>
          <div className="muted small">
            Type <strong>{artifact.artifactType}</strong> · status {artifact.status} · lifecycle{' '}
            {artifact.lifecycle}
          </div>
          {artifact.artifactFinalizedAt && (
            <div className="muted small">
              Finalized {formatFullTime(artifact.artifactFinalizedAt)}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-title">Payload</div>
          <pre className="command-box">{JSON.stringify(artifact.payload ?? {}, null, 2)}</pre>
        </section>

        <section className="card">
          <div className="card-title">Frozen lineage</div>
          {!artifact.sessions || artifact.sessions.length === 0 ? (
            <div className="muted">No lineage sessions.</div>
          ) : (
            <ul className="plain-list">
              {artifact.sessions.map((session) => (
                <li
                  key={session.sessionId}
                  className="list-row clickable"
                  onClick={() => onOpenSession(session.sessionId)}
                >
                  <span className="mono">{session.sessionId}</span> ·{' '}
                  <span className="muted small">{session.role}</span>
                  {session.sessionId === artifact.headSessionId && (
                    <span className="muted small"> · head</span>
                  )}
                  {session.rationale && <div className="muted small">{session.rationale}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
