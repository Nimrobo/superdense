import { useEffect, useState } from 'react';
import { api, type CohortAxis, type CohortSummary, type VersionChainSummary } from '../api.js';

interface Props {
  onOpenCohort: (type: string, connector?: string) => void;
  onOpenChain: (artifactId: string) => void;
}

export function CohortsView({ onOpenCohort, onOpenChain }: Props) {
  const [by, setBy] = useState<CohortAxis>('type');
  const [cohorts, setCohorts] = useState<CohortSummary[] | null>(null);
  const [chains, setChains] = useState<VersionChainSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCohorts({ by })
      .then((result) => {
        setCohorts(result.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [by]);

  useEffect(() => {
    api
      .listVersionChains()
      .then((result) => setChains(result.items))
      .catch(() => setChains([]));
  }, []);

  return (
    <>
      <div className="work-header">
        <div>
          <div className="work-title">Cohorts</div>
          <div className="work-sub">
            Compare what actually worked. Superdense surfaces comparable prior work; you judge.
          </div>
        </div>
      </div>
      <div className="work-body">
        <div className="sidebar-section-title">Peers</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className={by === 'type' ? 'nav-item active' : 'nav-item'}
            onClick={() => setBy('type')}
          >
            by type
          </button>
          <button
            type="button"
            className={by === 'connector' ? 'nav-item active' : 'nav-item'}
            onClick={() => setBy('connector')}
          >
            by connector
          </button>
        </div>

        {error && <div className="error">Failed to load: {error}</div>}
        {!cohorts && !error && <div className="empty">Loading...</div>}
        {cohorts?.length === 0 && <div className="empty">No finalized artifacts yet.</div>}
        {cohorts?.map((cohort) => (
          <button
            key={`${cohort.type}::${cohort.connector ?? ''}`}
            type="button"
            className="project-card"
            onClick={() => onOpenCohort(cohort.type, cohort.connector ?? undefined)}
          >
            <div className="project-card-top">
              <strong>
                {cohort.type}
                {cohort.connector ? ` · ${cohort.connector}` : ''}
              </strong>
              <span className="project-status">{cohort.artifactCount} artifacts</span>
            </div>
            <div className="muted small">
              {cohort.externalizedCount} externalized · {cohort.withRewardsCount} with rewards
            </div>
          </button>
        ))}

        {chains && chains.length > 0 && (
          <>
            <div className="sidebar-section-title" style={{ marginTop: 16 }}>
              Versions
            </div>
            {chains.map((chain) => (
              <button
                key={chain.rootId}
                type="button"
                className="project-card"
                onClick={() => onOpenChain(chain.rootId)}
              >
                <div className="project-card-top">
                  <strong>{chain.type}</strong>
                  <span className="project-status">{chain.length} versions</span>
                </div>
                <div className="muted small">A deliverable that evolved across versions.</div>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}
