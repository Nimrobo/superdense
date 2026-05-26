import { useEffect, useState } from 'react';
import {
  api,
  type CompactorName,
  type Session,
  type SessionCompactorResponse,
  type TranscriptEvent,
} from '../api.js';
import {
  formatDuration,
  formatFullTime,
  formatRelativeTime,
  formatShortDate,
  meaningfulPromptText,
  messageCountLabel,
  projectLabel,
  sessionTitle,
} from '../sessionDisplay.js';

const LONG_TEXT_LIMIT = 600;
const TOOL_INPUT_LIMIT = 120;

interface Props {
  id: string;
  onBack: () => void;
}

type TranscriptDisplayRow =
  | { type: 'event'; key: string; index: number; ev: TranscriptEvent }
  | { type: 'tool'; key: string; index: number; call?: TranscriptEvent; result?: TranscriptEvent }
  | { type: 'mode'; key: string; index: number; ev: TranscriptEvent }
  | { type: 'collapsed'; key: string; toolCount: number };

export function SessionReader({ id, onBack }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<'conversation' | 'summary'>('conversation');
  const [events, setEvents] = useState<TranscriptEvent[] | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    setSession(null);
    setEvents(null);
    api.getSession(id).then(setSession).catch(console.error);
  }, [id]);

  useEffect(() => {
    if (tab !== 'conversation' || events !== null) return;
    setLoadingEvents(true);
    api
      .getTranscript(id, { limit: 2000 })
      .then((r) => setEvents(r.items))
      .finally(() => setLoadingEvents(false));
  }, [tab, id, events]);

  if (!session)
    return (
      <div className="work-body">
        <div className="empty">Loading…</div>
      </div>
    );

  return (
    <>
      <SessionHeader session={session} onBack={onBack} />
      <div className="work-body">
        <div className="tabs">
          <button
            className={`tab ${tab === 'conversation' ? 'active' : ''}`}
            onClick={() => setTab('conversation')}
          >
            Conversation
          </button>
          <button
            className={`tab ${tab === 'summary' ? 'active' : ''}`}
            onClick={() => setTab('summary')}
          >
            Summary
          </button>
        </div>

        {tab === 'conversation' && (
          <ConversationTab sessionId={session.id} events={events} loading={loadingEvents} />
        )}

        {tab === 'summary' && <SummaryTab session={session} />}
      </div>
    </>
  );
}

function SessionHeader({ session, onBack }: { session: Session; onBack: () => void }) {
  const title = sessionTitle(session);
  const project = projectLabel(session.pwd);
  const duration = formatDuration(session.createdAt, session.modifiedAt);
  const messageCount = messageCountLabel(session.messageCount);
  const started = formatShortDate(session.createdAt);
  const lastActive = formatRelativeTime(session.modifiedAt);

  return (
    <div className="work-header session-reader-header">
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>
      <div className="work-heading">
        <div className="work-title">{title}</div>
        <div className="session-heading-meta">
          <span className="session-project" title={session.pwd}>
            {project}
          </span>
          <span className="session-id-chip mono" title={session.id}>
            ID {session.id}
          </span>
          {session.gitBranch && <span>{session.gitBranch}</span>}
          <span>{session.agent}</span>
          {duration && <span>{duration}</span>}
          {messageCount && <span>{messageCount}</span>}
          {started && <span title={formatFullTime(session.createdAt)}>started {started}</span>}
          {lastActive && (
            <span title={formatFullTime(session.modifiedAt)}>last active {lastActive}</span>
          )}
        </div>
        <div className="work-sub mono" title={session.pwd}>
          {session.pwd || '(no pwd)'}
        </div>
      </div>
    </div>
  );
}

function SummaryTab({ session }: { session: Session }) {
  const firstPrompt = meaningfulPromptText(session.firstPrompt);
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
          <span className="session-detail-label">Session ID</span>
          <span className="mono session-detail-value">{session.id}</span>
          <button
            className="text-btn"
            aria-label="Copy session ID"
            onClick={() => {
              void copyText(session.id);
            }}
          >
            Copy
          </button>
        </div>
        <div className="session-detail-row">
          <span className="session-detail-label">Log path</span>
          <span className="mono session-detail-value">{session.logPath}</span>
          <button
            className="text-btn"
            aria-label="Copy log path"
            onClick={() => {
              void copyText(session.logPath);
            }}
          >
            Copy
          </button>
        </div>
      </details>
    </div>
  );
}

function ConversationTab({
  sessionId,
  events,
  loading,
}: {
  sessionId: string;
  events: TranscriptEvent[] | null;
  loading: boolean;
}) {
  const [showSystem, setShowSystem] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [activeCompactor, setActiveCompactor] = useState<CompactorName | null>(null);
  const [compactorCache, setCompactorCache] = useState<
    Partial<Record<CompactorName, SessionCompactorResponse>>
  >({});
  const [loadingCompactor, setLoadingCompactor] = useState<CompactorName | null>(null);
  const [compactorError, setCompactorError] = useState<string | null>(null);

  const rows = events ? buildTranscriptRows(events) : null;
  const systemFiltered = rows?.filter((row) => {
    if (!showSystem && row.type === 'event' && row.ev.role === 'system') return false;
    return true;
  });
  const visibleRows = systemFiltered
    ? showTools
      ? systemFiltered
      : collapseAssistantRuns(systemFiltered)
    : undefined;

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runCompactor = async (name: CompactorName) => {
    setActiveCompactor(name);
    setCompactorError(null);
    if (compactorCache[name]) return;
    setLoadingCompactor(name);
    try {
      const result = await api.runSessionCompactor(sessionId, name);
      setCompactorCache((current) => ({ ...current, [name]: result }));
    } catch (err) {
      setCompactorError(
        `Failed to load ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingCompactor((current) => (current === name ? null : current));
    }
  };

  const activeOutput = activeCompactor ? compactorCache[activeCompactor] : undefined;
  const activeJson = activeOutput ? JSON.stringify(activeOutput, null, 2) : null;

  return (
    <div>
      <div className="conversation-filters" aria-label="Conversation filters">
        <div className="conversation-filter-group">
          <label>
            <input
              type="checkbox"
              checked={showSystem}
              onChange={(e) => setShowSystem(e.target.checked)}
            />
            Show system events
          </label>
          <label>
            <input
              type="checkbox"
              checked={showTools}
              onChange={(e) => setShowTools(e.target.checked)}
            />
            Show tool calls
          </label>
        </div>
        <div className="compactor-controls" aria-label="Session compactors">
          <span className="compactor-label">Compactors</span>
          <button
            className={`text-btn compactor-btn ${activeCompactor === 'trace' ? 'active' : ''}`}
            disabled={loadingCompactor !== null}
            onClick={() => {
              void runCompactor('trace');
            }}
          >
            {loadingCompactor === 'trace' ? 'Loading...' : 'Trace'}
          </button>
          <button
            className={`text-btn compactor-btn ${activeCompactor === 'salience' ? 'active' : ''}`}
            disabled={loadingCompactor !== null}
            onClick={() => {
              void runCompactor('salience');
            }}
          >
            {loadingCompactor === 'salience' ? 'Loading...' : 'Salience'}
          </button>
          {activeJson && (
            <button
              className="text-btn compactor-btn"
              onClick={() => {
                void copyText(activeJson);
              }}
            >
              Copy JSON
            </button>
          )}
        </div>
      </div>
      {activeCompactor && (
        <div className="compactor-drawer" data-testid="compactor-drawer">
          <div className="compactor-drawer-head">
            <span>{activeCompactor} compactor output</span>
          </div>
          {loadingCompactor === activeCompactor && (
            <div className="compactor-status">Loading {activeCompactor} compactor...</div>
          )}
          {compactorError && <div className="error compactor-error">{compactorError}</div>}
          {activeJson && (
            <pre className="compactor-json" data-testid="compactor-json">
              {activeJson}
            </pre>
          )}
        </div>
      )}
      {loading && <div className="empty">Loading conversation...</div>}
      {!loading &&
        visibleRows?.map((row) => {
          if (row.type === 'tool') {
            return (
              <ToolRow
                key={row.key}
                row={row}
                expanded={expanded.has(row.key)}
                onToggleExpanded={() => toggleExpanded(row.key)}
              />
            );
          }
          if (row.type === 'mode') {
            return <ModeChangeRow key={row.key} ev={row.ev} />;
          }
          if (row.type === 'collapsed') {
            return <CollapsedToolsRow key={row.key} count={row.toolCount} />;
          }
          return (
            <EventRow
              key={row.key}
              ev={row.ev}
              expanded={expanded.has(row.key)}
              onToggleExpanded={() => toggleExpanded(row.key)}
            />
          );
        })}
      {!loading && events && events.length === 0 && <div className="empty">No events.</div>}
      {!loading && events && events.length > 0 && rows?.length === 0 && (
        <div className="empty">No displayable events.</div>
      )}
      {!loading &&
        events &&
        events.length > 0 &&
        rows &&
        rows.length > 0 &&
        visibleRows?.length === 0 && (
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
    if (ev.kind === 'mode_change') {
      return [{ type: 'mode', key: `mode:${index}`, index, ev }];
    }
    const kind = eventKind(ev);
    if (kind === 'tool_call') {
      const paired = ev.toolCallId ? firstResultById.get(ev.toolCallId) : undefined;
      return [
        {
          type: 'tool',
          key: `tool:${ev.toolCallId ?? index}`,
          index,
          call: ev,
          result: paired?.ev,
        },
      ];
    }
    if (kind === 'tool_result') {
      if (pairedResultIndexes.has(index)) return [];
      return [
        {
          type: 'tool',
          key: `tool-result:${ev.toolCallId ?? index}:${index}`,
          index,
          result: ev,
        },
      ];
    }
    if (!hasDisplayableText(ev)) return [];
    return [{ type: 'event', key: `event:${index}`, index, ev }];
  });
}

function collapseAssistantRuns(rows: TranscriptDisplayRow[]): TranscriptDisplayRow[] {
  const inRun = (r: TranscriptDisplayRow) =>
    r.type === 'tool' || (r.type === 'event' && r.ev.role === 'assistant');
  const out: TranscriptDisplayRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!inRun(rows[i])) {
      out.push(rows[i]);
      i++;
      continue;
    }
    const runStart = i;
    let toolCount = 0;
    const assistantRows: Extract<TranscriptDisplayRow, { type: 'event' }>[] = [];
    while (i < rows.length && inRun(rows[i])) {
      const r = rows[i];
      if (r.type === 'tool') toolCount++;
      else if (r.type === 'event') assistantRows.push(r);
      i++;
    }
    if (toolCount === 0) {
      out.push(...assistantRows);
    } else {
      const last = assistantRows[assistantRows.length - 1];
      out.push({ type: 'collapsed', key: `collapsed:${runStart}`, toolCount });
      if (last) out.push(last);
    }
  }
  return out;
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
  const previewText =
    inputText.length > TOOL_INPUT_LIMIT ? `${inputText.slice(0, TOOL_INPUT_LIMIT)}...` : inputText;
  const canExpand = Boolean(inputText || resultText);

  return (
    <div className="event event-row tool">
      <div className="event-row-head">
        <div className="event-role">{row.call ? `tool · ${toolName}` : 'tool result'}</div>
        <EventTime ts={row.call?.ts ?? row.result?.ts} />
      </div>
      <div
        className="event-tool"
        data-testid={row.call?.toolName ? `tool-event-${row.call.toolName}` : 'tool-result-event'}
      >
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
      <div className="event-text">
        {displayText || <span className="muted">(empty event)</span>}
      </div>
      {isLong && <ExpandButton expanded={expanded} onClick={onToggleExpanded} />}
    </div>
  );
}

function ModeChangeRow({ ev }: { ev: TranscriptEvent }) {
  const label = modeChangeLabel(ev.mode, ev.prevMode);
  return (
    <div className="event event-row mode-change" data-testid="mode-change-row">
      <div className="event-row-head">
        <div className="event-role mode-change-label">→ {label}</div>
        <EventTime ts={ev.ts} />
      </div>
    </div>
  );
}

function modeChangeLabel(mode: string | undefined, prevMode: string | undefined): string {
  if (mode === 'plan' && prevMode !== 'plan') return 'entered plan mode';
  if (prevMode === 'plan' && mode !== 'plan') {
    return mode && mode !== 'default' ? `exited plan mode → ${mode}` : 'exited plan mode';
  }
  if (mode && prevMode) return `mode: ${prevMode} → ${mode}`;
  if (mode) return `mode: ${mode}`;
  return 'mode change';
}

function CollapsedToolsRow({ count }: { count: number }) {
  return (
    <div className="event event-row collapsed-tools" data-testid="collapsed-tools-row">
      <span className="muted">
        {count} tool call{count === 1 ? '' : 's'} collapsed
      </span>
    </div>
  );
}

function EventTime({ ts }: { ts?: number }) {
  if (!ts) return null;
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;
  return (
    <time className="event-time" dateTime={date.toISOString()} title={formatFullTime(ts)}>
      {formatRelativeTime(ts)}
    </time>
  );
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
