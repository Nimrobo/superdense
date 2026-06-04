import type { RewardTargetSeries } from './api.js';

// Shared reward/linkage rendering so the Cohorts view and the artifact detail
// render identical reward blocks instead of duplicating the markup.

export function metricsLine(metrics: Record<string, number>, primaryDim: string | null): string {
  return Object.entries(metrics)
    .map(([key, value]) => `${key === primaryDim ? '★' : ''}${key} ${value}`)
    .join('  ·  ');
}

export function Locator({ locator }: { locator: string | null }) {
  if (!locator) return null;
  return /^https?:\/\//i.test(locator) ? (
    <a href={locator} target="_blank" rel="noreferrer">
      {locator}
    </a>
  ) : (
    <span className="mono">{locator}</span>
  );
}

// Linked reward targets with their latest metrics + series length.
export function RewardTargetList({ targets }: { targets: RewardTargetSeries[] }) {
  if (targets.length === 0) {
    return <div className="muted small">No linked external identity yet.</div>;
  }
  return (
    <>
      {targets.map((target) => (
        <div key={target.targetId} style={{ marginTop: 6 }}>
          <div className="small">
            <strong>{target.connector}</strong>
            {target.locator ? (
              <>
                {' · '}
                <Locator locator={target.locator} />
              </>
            ) : null}
          </div>
          {target.latest ? (
            <div className="muted small">
              {metricsLine(target.latest.metrics, target.latest.primaryDim)}
              {target.snapshots.length > 1 ? ` · ${target.snapshots.length} snapshots` : ''}
            </div>
          ) : (
            <div className="muted small">No reward snapshot recorded.</div>
          )}
        </div>
      ))}
    </>
  );
}
