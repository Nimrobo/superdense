import type { Session } from '../api.js';

function relTime(ms?: number | null): string {
  if (!ms) return '';
  const d = Date.now() - ms;
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function SessionCard({ session, onClick }: { session: Session; onClick: () => void }) {
  return (
    <div className="session-card" onClick={onClick}>
      <div className="session-card-title">
        {session.firstPrompt?.trim() || session.summary?.trim() || '(no prompt)'}
      </div>
      {session.summary && session.firstPrompt !== session.summary && (
        <div className="session-card-summary">{session.summary}</div>
      )}
      <div className="session-card-meta">
        <span className="badge pwd" title={session.pwd}>{session.pwd || '(no pwd)'}</span>
        {session.gitBranch && <span className="badge">{session.gitBranch}</span>}
        {session.messageCount != null && <span>{session.messageCount} msgs</span>}
        <span>{relTime(session.modifiedAt)}</span>
      </div>
    </div>
  );
}
