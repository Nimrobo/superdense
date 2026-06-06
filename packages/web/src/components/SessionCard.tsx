import type { Session } from '../api.js';
import {
  formatDuration,
  formatRelativeTime,
  messageCountLabel,
  projectLabel,
  sessionTitle,
} from '../sessionDisplay.js';

type SessionCardProps =
  | { session: Session; onClick: () => void; href?: never }
  | { session: Session; href: string; onClick?: never };

export function SessionCard({ session, onClick, href }: SessionCardProps) {
  if ((href === undefined) === (onClick === undefined)) {
    throw new Error('SessionCard requires exactly one of href or onClick');
  }

  const title = sessionTitle(session);
  const project = projectLabel(session.pwd);
  const duration = formatDuration(session.createdAt, session.modifiedAt);
  const messageCount = messageCountLabel(session.messageCount);
  const lastActive = formatRelativeTime(session.modifiedAt);
  const cost = formatCostLabel(session.sessionCost);
  const workflow = session.workflowSummary?.hasWorkflow;

  const content = (
    <>
      <div className="session-card-title">{title}</div>
      {session.summary && session.firstPrompt !== session.summary && (
        <div className="session-card-summary">{session.summary}</div>
      )}
      <div className="session-card-meta">
        <span className="session-card-project" title={session.pwd}>
          {project}
        </span>
        <span className="session-id-chip mono" title={session.id}>
          ID {session.id}
        </span>
        {session.gitBranch && <span className="badge">{session.gitBranch}</span>}
        {workflow && <span className="badge">workflow</span>}
        {messageCount && <span>{messageCount}</span>}
        {cost && <span className="badge cost-chip">{cost}</span>}
        {duration && <span>{duration}</span>}
        {lastActive && <span>{lastActive}</span>}
      </div>
    </>
  );

  if (href) {
    return (
      <a className="session-card" href={href} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }

  return (
    <div className="session-card" onClick={onClick}>
      {content}
    </div>
  );
}

function formatCostLabel(cost: Session['sessionCost']): string | null {
  if (!cost) return null;
  if (typeof cost.estimatedCostUsd === 'number') return formatUsd(cost.estimatedCostUsd);
  const tokens = cost.tokenTotals.totalTokens;
  return tokens > 0 ? `${formatTokenCount(tokens)} tokens` : null;
}

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}
