import { useEffect, useState } from 'react';
import { api, type Session, type TranscriptEvent } from '../api.js';

interface Props {
  id: string;
  onBack: () => void;
}

export function SessionReader({ id, onBack }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [events, setEvents] = useState<TranscriptEvent[] | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
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
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <div style={{ flex: 1 }}>
          <div className="work-title">{session.firstPrompt?.trim() || session.summary?.trim() || '(no prompt)'}</div>
          <div className="work-sub mono">{session.pwd}</div>
        </div>
      </div>
      <div className="work-body">
        <div className="session-header">
          <div className="session-meta-row">
            <span className="badge">{session.agent}</span>
            {session.gitBranch && <span className="badge">{session.gitBranch}</span>}
            {session.messageCount != null && <span>{session.messageCount} messages</span>}
            {session.modifiedAt && <span>last activity {new Date(session.modifiedAt).toLocaleString()}</span>}
          </div>
        </div>

        <div className="tabs">
          <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>Summary</button>
          <button className={`tab ${tab === 'transcript' ? 'active' : ''}`} onClick={() => setTab('transcript')}>Transcript</button>
        </div>

        {tab === 'summary' && (
          <div>
            <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>First prompt</h3>
            <div style={{ whiteSpace: 'pre-wrap', marginBottom: 16, lineHeight: 1.5 }}>{session.firstPrompt ?? <span className="muted">(none)</span>}</div>
            <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Summary</h3>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{session.summary ?? <span className="muted">(none)</span>}</div>
            <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '20px 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Log path</h3>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{session.logPath}</div>
          </div>
        )}

        {tab === 'transcript' && (
          <div>
            {loadingEvents && <div className="empty">Loading transcript…</div>}
            {!loadingEvents && events?.map((ev, i) => <EventRow key={i} ev={ev} />)}
            {!loadingEvents && events && events.length === 0 && <div className="empty">No events.</div>}
          </div>
        )}
      </div>
    </>
  );
}

function EventRow({ ev }: { ev: TranscriptEvent }) {
  if (ev.toolName) {
    return (
      <div className="event assistant">
        <div className="event-role">tool · {ev.toolName}</div>
        <div className="event-tool">
          <span className="event-tool-name">{ev.toolName}</span>{' '}
          {ev.inputText && ev.inputText.length > 600 ? ev.inputText.slice(0, 600) + '…' : ev.inputText}
        </div>
      </div>
    );
  }
  return (
    <div className={`event ${ev.role ?? ''}`}>
      <div className="event-role">{ev.role ?? 'event'}</div>
      <div className="event-text">{(ev.text ?? '').slice(0, 4000)}</div>
    </div>
  );
}
