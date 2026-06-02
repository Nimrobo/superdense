import { useEffect, useState } from 'react';
import { api, type Artifact } from '../api.js';
import { ThreadDetails } from './ThreadDetails.js';

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
      <ThreadDetails thread={artifact} onOpenSession={onOpenSession} />
    </>
  );
}
