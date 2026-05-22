import type { Session } from '../api.js';
import { formatDuration, formatRelativeTime, messageCountLabel, projectLabel, sessionTitle } from '../sessionDisplay.js';

export function SessionCard({ session, onClick }: { session: Session; onClick: () => void }) {
  const title = sessionTitle(session);
  const project = projectLabel(session.pwd);
  const duration = formatDuration(session.createdAt, session.modifiedAt);
  const messageCount = messageCountLabel(session.messageCount);
  const lastActive = formatRelativeTime(session.modifiedAt);

  return (
    <div className="session-card" onClick={onClick}>
      <div className="session-card-title">
        {title}
      </div>
      {session.summary && session.firstPrompt !== session.summary && (
        <div className="session-card-summary">{session.summary}</div>
      )}
      <div className="session-card-meta">
        <span className="session-card-project" title={session.pwd}>{project}</span>
        <span className="session-id-chip mono" title={session.id}>ID {session.id}</span>
        {session.gitBranch && <span className="badge">{session.gitBranch}</span>}
        {messageCount && <span>{messageCount}</span>}
        {duration && <span>{duration}</span>}
        {lastActive && <span>{lastActive}</span>}
      </div>
    </div>
  );
}
