import type { ArtifactExternalization, ArtifactRewards, WorkThread } from '../api.js';
import { formatFullTime } from '../sessionDisplay.js';
import { Locator, RewardTargetList } from '../rewardDisplay.js';

interface Props {
  thread: WorkThread;
  projectName?: string;
  externalization?: ArtifactExternalization | null;
  rewards?: ArtifactRewards | null;
  onOpenSession: (id: string) => void;
}

export function ThreadDetails({
  thread,
  projectName,
  externalization,
  rewards,
  onOpenSession,
}: Props) {
  return (
    <div className="work-body project-detail">
      <section className="card">
        <div className="card-title">Work thread</div>
        <div className="muted small">
          Project <strong>{projectName ?? thread.projectProfileId}</strong>
          {projectName && <> · {thread.projectProfileId}</>} · status {thread.status} · lifecycle{' '}
          {thread.lifecycle}
          {thread.humanOnly ? ' · Human only' : ''}
        </div>
        <div className="muted small">
          Created {formatFullTime(thread.createdAt)} · Updated {formatFullTime(thread.updatedAt)}
        </div>
        {thread.artifactFinalizedAt && (
          <div className="muted small">
            Artifact finalized {formatFullTime(thread.artifactFinalizedAt)}
          </div>
        )}
        {thread.readyAt && (
          <div className="muted small">
            Marked ready {formatFullTime(thread.readyAt)}
            {thread.readinessRationale ? ` · ${thread.readinessRationale}` : ''}
          </div>
        )}
        {thread.predecessorArtifactId && (
          <div className="muted small">Successor of {thread.predecessorArtifactId}</div>
        )}
        {thread.summary && <p>{thread.summary}</p>}
      </section>

      {thread.artifactType && (
        <section className="card">
          <div className="card-title">Artifact payload</div>
          <div className="muted small">
            Type <strong>{thread.artifactType}</strong>
          </div>
          <pre className="command-box">{JSON.stringify(thread.payload ?? {}, null, 2)}</pre>
        </section>
      )}

      {externalization !== undefined && (
        <section className="card">
          <div className="card-title">External linkage</div>
          <div className="muted small">
            Status <strong>{externalization?.status ?? 'unprocessed'}</strong>
            {externalization?.conclusion ? ` · conclusion ${externalization.conclusion}` : ''}
          </div>
          {externalization?.evidence && <p className="small">{externalization.evidence}</p>}
          {!externalization || externalization.targets.length === 0 ? (
            <div className="muted">No external targets recorded.</div>
          ) : (
            <ul className="plain-list">
              {externalization.targets.map((target) => (
                <li key={target.id} className="list-row">
                  <span className="small">
                    <strong>{target.connector}</strong> · {target.status}
                    {target.locator ? (
                      <>
                        {' · '}
                        <Locator locator={target.locator} />
                      </>
                    ) : null}
                  </span>
                  {target.evidence && <div className="muted small">{target.evidence}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {rewards !== undefined && (
        <section className="card">
          <div className="card-title">Rewards</div>
          <RewardTargetList targets={rewards?.targets ?? []} />
        </section>
      )}

      <section className="card">
        <div className="card-title">Effective lineage</div>
        {!thread.sessions || thread.sessions.length === 0 ? (
          <div className="muted">
            {thread.humanOnly
              ? 'Human-only artifact; no contributing agent sessions.'
              : 'No linked sessions.'}
          </div>
        ) : (
          <ul className="plain-list">
            {thread.sessions.map((session) => (
              <li
                key={session.sessionId}
                className="list-row clickable"
                onClick={() => onOpenSession(session.sessionId)}
              >
                <span className="mono">{session.sessionId}</span> ·{' '}
                <span className="muted small">{session.role}</span>
                {session.sessionId === thread.headSessionId && (
                  <span className="muted small"> · head</span>
                )}
                {session.rationale && <div className="muted small">{session.rationale}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-title">Lineage events</div>
        {!thread.lineageEvents || thread.lineageEvents.length === 0 ? (
          <div className="muted">No lineage events.</div>
        ) : (
          <ul className="plain-list">
            {thread.lineageEvents.map((event) => (
              <li key={event.id} className="list-row">
                <span className="mono">{event.sessionId}</span> ·{' '}
                <span className="muted small">
                  {event.eventType} {event.role}
                </span>
                {event.rationale && <div className="muted small">{event.rationale}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
