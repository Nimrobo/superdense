import { useEffect, useState } from 'react';
import { api, type Artifact, type ArtifactExternalization, type ArtifactRewards } from '../api.js';
import { ThreadDetails } from './ThreadDetails.js';

interface Props {
  id: string;
  onBack: () => void;
  onOpenSession: (id: string) => void;
}

export function ArtifactView({ id, onBack, onOpenSession }: Props) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [externalization, setExternalization] = useState<ArtifactExternalization | null>(null);
  const [rewards, setRewards] = useState<ArtifactRewards | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getArtifact(id)
      .then((result) => {
        setArtifact(result.artifact);
        setExternalization(result.externalization);
        setRewards(result.rewards);
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
          <div className="work-sub">
            {artifact.artifactType}
            {artifact.humanOnly ? ' · Human only' : ''}
          </div>
        </div>
      </div>
      <ThreadDetails
        thread={artifact}
        externalization={externalization}
        rewards={rewards}
        onOpenSession={onOpenSession}
      />
    </>
  );
}
