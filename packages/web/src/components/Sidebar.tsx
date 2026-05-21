import type { Group, PluginInfo } from '../api.js';
import type { View } from '../App.js';

interface Props {
  view: View;
  setView: (v: View) => void;
  plugins: PluginInfo[];
  groups: Group[];
  search: string;
  setSearch: (s: string) => void;
  progress: { phase: string; total: number; done: number } | null;
  onReindex: () => void;
}

export function Sidebar({ view, setView, plugins, groups, search, setSearch, progress, onReindex }: Props) {
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
          <div className="sidebar-section-title">Plugins</div>
          {plugins.length === 0 && <div className="nav-item muted">No plugins</div>}
          {plugins.map((p) => (
            <div
              key={p.name}
              className={active(view.type === 'plugin' && view.name === p.name)}
              onClick={() => setView({ type: 'plugin', name: p.name })}
              title={p.description ?? p.title}
            >
              <span>{p.title}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Saved groups</div>
          {groups.length === 0 && <div className="nav-item muted">None yet</div>}
          {groups.map((g) => (
            <div
              key={g.id}
              className={active(view.type === 'group' && view.id === g.id)}
              onClick={() => setView({ type: 'group', id: g.id })}
            >
              <span>{g.name}</span>
              <span className="count">{g.memberCount ?? 0}</span>
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
