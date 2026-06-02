import { useEffect, useState } from 'react';
import { api, type Artifact } from '../api.js';
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

export function ArtifactsView({ onOpen }: Props) {
  const [items, setItems] = useState<Artifact[] | null>(null);
  const [ready, setReady] = useState<Artifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listArtifacts(), api.listFinalizableThreads()])
      .then(([artifacts, threads]) => {
        setItems(artifacts.items);
        setReady(threads.items);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const copyCommand = async (threadId: string) => {
    await navigator.clipboard.writeText(`/superdense-artifact-finalize ${threadId}`);
    setToast('Finalize command copied. Paste it into Claude Code or Codex.');
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">Artifacts</div>
          <div className="work-sub">Immutable artifacts frozen from finalized work threads</div>
        </div>
      </div>
      <div className="work-body">
        {error && <div className="error">Failed to load: {error}</div>}

        {ready.length > 0 && (
          <section className="card">
            <div className="card-title">Ready to extract</div>
            <div className="muted small">
              Finalized work threads with no artifact yet. Run the skill to extract one.
            </div>
            <ul className="plain-list">
              {ready.map((thread) => (
                <li key={thread.id} className="project-detail-actions">
                  <div>
                    <strong>{thread.provisionalTitle}</strong>
                    <div className="muted small mono">{thread.id}</div>
                  </div>
                  <button className="copy-btn" onClick={() => copyCommand(thread.id)}>
                    Copy finalize command
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

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
              finalized {formatRelativeTime(artifact.artifactFinalizedAt ?? artifact.updatedAt)}
            </div>
          </button>
        ))}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}
