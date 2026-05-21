import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Stats } from '../api.js';

interface Props {
  progress: { phase: string; total: number; done: number } | null;
  onReindex: () => void;
  onOpenSession: (id: string) => void;
  onOpenQuery: (id: string) => void;
  onOpenSessions: () => void;
}

function relTime(ms?: number | null): string {
  if (!ms) return '—';
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

function shortDate(d: string): string {
  const [, m, day] = d.split('-');
  return m && day ? `${m}/${day}` : d;
}

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

export function DashboardView({ progress, onReindex, onOpenSession, onOpenQuery, onOpenSessions }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api.stats()
      .then((s) => { setStats(s); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => { refresh(); }, []);

  if (error) return <div className="dashboard"><div className="error">Failed to load: {error}</div></div>;
  if (!stats) return <div className="dashboard"><div className="muted">Loading…</div></div>;

  const busy = progress && progress.phase !== 'idle';
  const t = stats.totals;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <button className="reindex-btn" onClick={refresh}>Refresh</button>
      </div>

      <div className="stat-row">
        <Stat label="Sessions" value={t.sessions} />
        <Stat label="Last 7 days" value={t.sessionsLast7d} />
        <Stat label="Projects" value={t.distinctPwds} />
        <Stat label="Agents" value={t.distinctAgents} />
        <Stat label="Queries" value={t.queries} />
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-title">Indexing</div>
          <div className="kv">
            <span>Last indexed</span>
            <strong>{relTime(stats.lastIndexedAt)}</strong>
          </div>
          <div className="kv">
            <span>Status</span>
            <strong>
              {busy
                ? `${progress!.phase} ${progress!.done}/${progress!.total}`
                : 'idle'}
            </strong>
          </div>
          <button className="reindex-btn" onClick={onReindex} disabled={!!busy}>Reindex</button>
        </div>

        <div className="card card-wide">
          <div className="card-title">Sessions per day (last 30)</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.perDay.map((d) => ({ date: shortDate(d.date), count: d.count }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--accent, #4f8cff)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card card-wide">
          <div className="card-title">Top tools used</div>
          {stats.topTools.length === 0 ? (
            <div className="muted">No tool data yet — run a reindex.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, stats.topTools.length * 24)}>
              <BarChart data={stats.topTools} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="tool" width={100} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--accent, #4f8cff)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <div className="card-title">Top working directories</div>
          {stats.topPwds.length === 0 && <div className="muted">None</div>}
          <ul className="list">
            {stats.topPwds.map((p) => (
              <li key={p.pwd} className="list-row clickable" onClick={onOpenSessions} title={p.pwd}>
                <span className="ellipsis">{basename(p.pwd)}</span>
                <span className="count">{p.count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="card-title">Top queries</div>
          {stats.topQueries.length === 0 && <div className="muted">No queries yet</div>}
          <ul className="list">
            {stats.topQueries.map((q) => (
              <li key={q.id} className="list-row clickable" onClick={() => onOpenQuery(q.id)}>
                <span className="ellipsis">{q.name}</span>
                <span className="count">{q.memberCount}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card card-wide">
          <div className="card-title">Recent sessions</div>
          <ul className="list">
            {stats.recentSessions.map((s) => (
              <li key={s.id} className="list-row clickable" onClick={() => onOpenSession(s.id)}>
                <span className="ellipsis">
                  {s.firstPrompt?.trim() || s.summary?.trim() || '(no prompt)'}
                </span>
                <span className="muted small">{relTime(s.modifiedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
