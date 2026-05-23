import { useEffect, useState } from 'react';
import { api, type Query, type Session } from '../api.js';
import { sessionHref } from '../urls.js';
import { SessionCard } from './SessionCard.js';

interface Props {
  id: string;
  onBack: () => void;
  onDeleted: () => void;
}

export function QueryView({ id, onBack, onDeleted }: Props) {
  const [query, setQuery] = useState<(Query & { members: Session[] }) | null>(null);

  useEffect(() => {
    api.getQuery(id).then(setQuery).catch(console.error);
  }, [id]);

  if (!query) return <div className="work-body"><div className="empty">Loading...</div></div>;

  const del = async () => {
    if (!confirm(`Delete query "${query.name}"?`)) return;
    await api.deleteQuery(id);
    onDeleted();
  };

  const run = async () => {
    await api.runQuery(id);
    setQuery(await api.getQuery(id));
  };

  return (
    <>
      <div className="work-header">
        <button className="back-btn" onClick={onBack}>Back</button>
        <div style={{ flex: 1 }}>
          <div className="work-title">{query.name}</div>
          <div className="work-sub">{query.members.length} sessions</div>
        </div>
        <button className="btn secondary" onClick={run}>Run</button>
        <button className="btn secondary" onClick={del}>Delete</button>
      </div>
      <div className="work-body">
        <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Query</h3>
        <pre className="mono" style={{ fontSize: 12, background: 'var(--bg-soft)', padding: 10, borderRadius: 6, border: '1px solid var(--border)', overflowX: 'auto' }}>
{JSON.stringify({ filters: query.filters, enrichers: query.enrichers }, null, 2)}
        </pre>
        <h3 style={{ fontSize: 12, color: 'var(--text-muted)', margin: '18px 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Matches</h3>
        {query.members.length === 0 && <div className="empty">No sessions matched this query.</div>}
        {query.members.map((s) => <SessionCard key={s.id} session={s} href={sessionHref(s.id)} />)}
      </div>
    </>
  );
}
