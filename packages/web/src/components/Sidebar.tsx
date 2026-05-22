import type { Query } from '../api.js';
import type { View } from '../App.js';

interface Props {
  view: View;
  setView: (v: View) => void;
  queries: Query[];
  search: string;
  setSearch: (s: string) => void;
  progress: { phase: string; total: number; done: number } | null;
  onReindex: () => void;
}

export function Sidebar({ view, setView, queries, search, setSearch, progress, onReindex }: Props) {
  const active = (test: boolean) => (test ? 'nav-item active' : 'nav-item');
  const busy = progress && progress.phase !== 'idle';
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">road42</div>
        <div className="brand-sub">your coding agent traces</div>
        <input
          className="search-input"
          placeholder="Search sessions…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setView({ type: 'sessions' }); }}
        />
      </div>

      <div className="sidebar-body">
        <div className="sidebar-section">
          <div className="sidebar-section-title">Browse</div>
          <div
            className={active(view.type === 'dashboard')}
            onClick={() => setView({ type: 'dashboard' })}
          >
            <span>Dashboard</span>
          </div>
          <div
            className={active(view.type === 'sessions')}
            onClick={() => setView({ type: 'sessions' })}
          >
            <span>Sessions</span>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Saved queries</div>
          <div
            className={active(view.type === 'query-builder')}
            onClick={() => setView({ type: 'query-builder' })}
          >
            <span>New query</span>
          </div>
          {queries.length === 0 && <div className="nav-item muted">None yet</div>}
          {queries.map((q) => (
            <div
              key={q.id}
              className={active(view.type === 'query' && view.id === q.id)}
              onClick={() => setView({ type: 'query', id: q.id })}
            >
              <span>{q.name}</span>
              <span className="count">{q.memberCount ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className={`progress-dot ${busy ? 'active' : ''}`} />
          <span>
            {busy
              ? `${progress!.phase} ${progress!.done}/${progress!.total}`
              : 'idle'}
          </span>
        </div>
        <button className="reindex-btn" onClick={onReindex} disabled={!!busy}>Reindex</button>
      </div>
    </aside>
  );
}
