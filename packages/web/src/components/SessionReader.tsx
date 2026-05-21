import { useEffect, useState } from 'react';
import { api, type Session, type TranscriptEvent } from '../api.js';

const LONG_TEXT_LIMIT = 600;
const TOOL_INPUT_LIMIT = 120;

interface Props {
  id: string;
  onBack: () => void;
}

type TranscriptDisplayRow =
  | { type: 'event'; key: string; index: number; ev: TranscriptEvent }
  | { type: 'tool'; key: string; index: number; call?: TranscriptEvent; result?: TranscriptEvent };

export function SessionReader({ id, onBack }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [events, setEvents] = useState<TranscriptEvent[] | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    setSession(null);
    setEvents(null);
    api.getSession(id).then(setSession).catch(console.error);
  }, [id]);

  useEffect(() => {
    if (tab !== 'transcript' || events !== null) return;
    setLoadingEvents(true);
    api.getTranscript(id, { limit: 2000 })
      .then((r) => setEvents(r.items))
      .finally(() => setLoadingEvents(false));
  }, [tab, id, events]);

  if (!session) return <div className="work-body"><div className="empty">Loading…</div></div>;

  return (
    <>
      <SessionHeader session={session} onBack={onBack} />
      <div className="work-body">
        <SessionMeta session={session} />

        <div className="tabs">
          <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>Summary</button>
          <button className={`tab ${tab === 'transcript' ? 'active' : ''}`} onClick={() => setTab('transcript')}>Transcript</button>
        </div>

        {tab === 'summary' && <SummaryTab session={session} />}

        {tab === 'transcript' && (
          <TranscriptTab events={events} loading={loadingEvents} />
        )}
      </div>
    </>
  );
}

function SessionHeader({ session, onBack }: { session: Session; onBack: () => void }) {
  const title = session.firstPrompt?.trim() || session.summary?.trim() || '(no prompt)';

  return (
    <div className="work-header">
      <button className="back-btn" onClick={onBack}>← Back</button>
      <div className="work-heading">
        <div className="work-title">{title}</div>
        <div className="work-sub mono">{session.pwd}</div>
      </div>
    </div>
  );
}

function SessionMeta({ session }: { session: Session }) {
  return (
    <div className="session-header">
      <div className="session-meta-row">
        <span className="badge">{session.agent}</span>
        {session.gitBranch && <span className="badge">{session.gitBranch}</span>}
      </div>
      <div className="session-meta-muted">
        {session.messageCount != null && <span>{session.messageCount} messages</span>}
        {session.modifiedAt && (
          <span title={formatFullTime(session.modifiedAt)}>
            last activity {formatRelativeTime(session.modifiedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function SummaryTab({ session }: { session: Session }) {
  const firstPrompt = session.firstPrompt?.trim();
  const summary = session.summary?.trim();

  return (
    <div className="session-summary">
      {firstPrompt && (
        <section className="session-summary-section">
          <h3>First prompt</h3>
          <div>{firstPrompt}</div>
        </section>
      )}
      {summary && (
        <section className="session-summary-section">
          <h3>Summary</h3>
          <div>{summary}</div>
        </section>
      )}
      {!firstPrompt && !summary && <div className="session-summary-empty">No summary yet.</div>}
      <details className="session-details-disclosure">
        <summary>Details</summary>
        <div className="session-detail-row">
          <span className="mono session-log-path">{session.logPath}</span>
          <button className="text-btn" onClick={() => { void copyText(session.logPath); }}>Copy</button>
        </div>
      </details>
    </div>
  );
}

function TranscriptTab({ events, loading }: { events: TranscriptEvent[] | null; loading: boolean }) {
  const [showSystem, setShowSystem] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const rows = events ? buildTranscriptRows(events) : null;
  const visibleRows = rows
    ?.filter((row) => {
      if (!showTools && row.type === 'tool') return false;
      if (!showSystem && row.type === 'event' && row.ev.role === 'system') return false;
      return true;
    });

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <div className="transcript-filters" aria-label="Transcript filters">
        <label>
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
          Show system events
        </label>
        <label>
          <input type="checkbox" checked={showTools} onChange={(e) => setShowTools(e.target.checked)} />
          Show tool calls
        </label>
      </div>
      {loading && <div className="empty">Loading transcript...</div>}
      {!loading && visibleRows?.map((row) => (
        row.type === 'tool' ? (
          <ToolRow
            key={row.key}
            row={row}
            expanded={expanded.has(row.key)}
            onToggleExpanded={() => toggleExpanded(row.key)}
          />
        ) : (
          <EventRow
            key={row.key}
            ev={row.ev}
            expanded={expanded.has(row.key)}
            onToggleExpanded={() => toggleExpanded(row.key)}
          />
        )
      ))}
      {!loading && events && events.length === 0 && <div className="empty">No events.</div>}
      {!loading && events && events.length > 0 && rows?.length === 0 && (
        <div className="empty">No displayable events.</div>
      )}
      {!loading && events && events.length > 0 && rows && rows.length > 0 && visibleRows?.length === 0 && (
        <div className="empty">No events match the current filters.</div>
      )}
    </div>
  );
}

function buildTranscriptRows(events: TranscriptEvent[]): TranscriptDisplayRow[] {
  const callIds = new Set<string>();
  const firstResultById = new Map<string, { ev: TranscriptEvent; index: number }>();

  events.forEach((ev, index) => {
    if (eventKind(ev) === 'tool_call' && ev.toolCallId) callIds.add(ev.toolCallId);
    if (eventKind(ev) === 'tool_result' && ev.toolCallId && !firstResultById.has(ev.toolCallId)) {
      firstResultById.set(ev.toolCallId, { ev, index });
    }
  });
  const pairedResultIndexes = new Set(
    Array.from(firstResultById.entries())
      .filter(([toolCallId]) => callIds.has(toolCallId))
      .map(([, result]) => result.index),
  );

  return events.flatMap((ev, index): TranscriptDisplayRow[] => {
    const kind = eventKind(ev);
    if (kind === 'tool_call') {
      const paired = ev.toolCallId ? firstResultById.get(ev.toolCallId) : undefined;
      return [{
        type: 'tool',
        key: `tool:${ev.toolCallId ?? index}`,
        index,
        call: ev,
        result: paired?.ev,
      }];
    }
    if (kind === 'tool_result') {
      if (pairedResultIndexes.has(index)) return [];
      return [{
        type: 'tool',
        key: `tool-result:${ev.toolCallId ?? index}:${index}`,
        index,
        result: ev,
      }];
    }
    if (!hasDisplayableText(ev)) return [];
    return [{ type: 'event', key: `event:${index}`, index, ev }];
  });
}

function eventKind(ev: TranscriptEvent): 'text' | 'tool_call' | 'tool_result' {
  if (ev.kind === 'tool_call' || ev.kind === 'tool_result' || ev.kind === 'text') return ev.kind;
  if (ev.toolName) return 'tool_call';
  return 'text';
}

function hasDisplayableText(ev: TranscriptEvent): boolean {
  return typeof ev.text === 'string' && ev.text.trim().length > 0;
}

function ToolRow({
  row,
  expanded,
  onToggleExpanded,
}: {
  row: Extract<TranscriptDisplayRow, { type: 'tool' }>;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const inputText = row.call?.inputText ?? '';
  const resultText = row.result?.text ?? '';
  const toolName = row.call?.toolName ?? 'tool result';
  const previewText = inputText.length > TOOL_INPUT_LIMIT ? `${inputText.slice(0, TOOL_INPUT_LIMIT)}...` : inputText;
  const canExpand = Boolean(inputText || resultText);

  return (
    <div className="event event-row tool">
      <div className="event-row-head">
        <div className="event-role">{row.call ? `tool · ${toolName}` : 'tool result'}</div>
        <EventTime ts={row.call?.ts ?? row.result?.ts} />
      </div>
      <div className="event-tool" data-testid={row.call?.toolName ? `tool-event-${row.call.toolName}` : 'tool-result-event'}>
        <span className="event-tool-name">{toolName}</span>
        {row.call && previewText && <span> {previewText}</span>}
        {!row.call && <span className="muted"> result hidden</span>}
        {row.call && row.result && <span className="muted"> · result hidden</span>}
      </div>
      {expanded && (
        <div className="event-tool-sections">
          {inputText && <ToolSection label="Input" text={inputText} />}
          {resultText && <ToolSection label="Result" text={resultText} />}
          {!inputText && !resultText && <div className="muted">(empty tool event)</div>}
        </div>
      )}
      {canExpand && <ExpandButton expanded={expanded} onClick={onToggleExpanded} />}
    </div>
  );
}

function ToolSection({ label, text }: { label: string; text: string }) {
  return (
    <div className="event-tool-section">
      <div className="event-tool-section-label">{label}</div>
      <div className="event-tool-section-body">{text}</div>
    </div>
  );
}

function EventRow({
  ev,
  expanded,
  onToggleExpanded,
}: {
  ev: TranscriptEvent;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const text = ev.text ?? '';
  const isLong = text.length > LONG_TEXT_LIMIT;
  const displayText = expanded || !isLong ? text : `${text.slice(0, LONG_TEXT_LIMIT)}...`;
  const role = displayRole(ev.role);
  const roleClass = roleClassName(ev.role);

  return (
    <div className={`event event-row ${roleClass}`}>
      <div className="event-row-head">
        <div className="event-role">{role}</div>
        <EventTime ts={ev.ts} />
      </div>
      <div className="event-text">{displayText || <span className="muted">(empty event)</span>}</div>
      {isLong && <ExpandButton expanded={expanded} onClick={onToggleExpanded} />}
    </div>
  );
}

function EventTime({ ts }: { ts?: number }) {
  if (!ts) return null;
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;
  return <time className="event-time" dateTime={date.toISOString()} title={formatFullTime(ts)}>{formatRelativeTime(ts)}</time>;
}

function ExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button className="event-expand-btn" onClick={onClick}>
      {expanded ? 'Show less' : 'Show more'}
    </button>
  );
}

function displayRole(role: TranscriptEvent['role'] | string | undefined): string {
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  return 'event';
}

function roleClassName(role: TranscriptEvent['role'] | string | undefined): string {
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  return 'unknown';
}

function formatRelativeTime(ts: number): string {
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return '';
  const diffMs = ts - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) return 'just now';
  if (absMs < hour) return formatRelativeUnit(diffMs, minute, 'minute');
  if (absMs < day) return formatRelativeUnit(diffMs, hour, 'hour');
  if (absMs < 30 * day) return formatRelativeUnit(diffMs, day, 'day');
  return date.toLocaleDateString();
}

function formatRelativeUnit(diffMs: number, unitMs: number, label: string): string {
  const value = Math.round(Math.abs(diffMs) / unitMs);
  const suffix = diffMs < 0 ? 'ago' : 'from now';
  return `${value} ${label}${value === 1 ? '' : 's'} ${suffix}`;
}

function formatFullTime(ts: number): string {
  const date = new Date(ts);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '';
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back for denied permissions or insecure contexts.
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  if (document.execCommand) document.execCommand('copy');
  document.body.removeChild(input);
}
