import { useEffect, useState } from 'react';
import { api, type ArtifactListItem } from '../api.js';
import { formatRelativeTime } from '../sessionDisplay.js';

interface Props {
  onOpen: (id: string) => void;
}

function payloadPreview(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  if (typeof payload.text === 'string') return payload.text;
  if (Array.isArray(payload.files)) return (payload.files as unknown[]).join(', ');
  return JSON.stringify(payload);
}

const LINKAGE_LABEL: Record<ArtifactListItem['externalizationStatus'], string> = {
  linked: 'linked',
  blocked: 'blocked',
  not_external: 'internal',
  unprocessed: 'not assessed',
};

export function ArtifactsView({ onOpen }: Props) {
  const [items, setItems] = useState<ArtifactListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listArtifacts()
      .then((artifacts) => setItems(artifacts.items))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">Artifacts</div>
          <div className="work-sub">Stable artifact payloads with append-only provenance</div>
        </div>
      </div>
      <div className="work-body">
        {error && <div className="error">Failed to load: {error}</div>}
        {!items && !error && <div className="empty">Loading...</div>}
        {items?.length === 0 && <div className="empty">No finalized artifacts yet.</div>}
        {items?.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            className="project-card"
            onClick={() => onOpen(artifact.id)}
          >
            <div className="project-card-top">
              <strong>{artifact.provisionalTitle}</strong>
              <span className="project-status">{artifact.artifactType}</span>
            </div>
            <div className="project-card-description ellipsis">
              {payloadPreview(artifact.payload)}
            </div>
            <div className="muted small">
              finalized {formatRelativeTime(artifact.artifactFinalizedAt ?? artifact.updatedAt)} ·{' '}
              {LINKAGE_LABEL[artifact.externalizationStatus]}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
