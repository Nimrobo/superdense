import { useEffect, useState } from 'react';
import { api, type Query } from './api.js';
import { Sidebar } from './components/Sidebar.js';
import { SessionsView } from './components/SessionsView.js';
import { SessionReader } from './components/SessionReader.js';
import { QueryView } from './components/QueryView.js';
import { QueryBuilder } from './components/QueryBuilder.js';
import { DashboardView } from './components/DashboardView.js';

export type View =
  | { type: 'dashboard' }
  | { type: 'sessions' }
  | { type: 'session'; id: string }
  | { type: 'query-builder' }
  | { type: 'query'; id: string };

export function App() {
  const [view, setView] = useState<View>({ type: 'dashboard' });
  const [queries, setQueries] = useState<Query[]>([]);
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<{ phase: string; total: number; done: number } | null>(null);

  const refresh = async () => {
    const q = await api.listQueries();
    setQueries(q.items);
  };

  useEffect(() => { refresh().catch(console.error); }, []);
  useEffect(() => {
    const t = setInterval(() => {
      api.progress().then((p) => setProgress(p)).catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const doReindex = async () => {
    await api.reindex(false);
    setTimeout(refresh, 1000);
  };

  return (
    <div className="app">
      <Sidebar
        view={view}
        setView={setView}
        queries={queries}
        search={search}
        setSearch={setSearch}
        progress={progress}
        onReindex={doReindex}
      />
      <main className="work">
        {view.type === 'dashboard' && (
          <DashboardView
            progress={progress}
            onReindex={doReindex}
            onOpenSession={(id) => setView({ type: 'session', id })}
            onOpenSessions={() => setView({ type: 'sessions' })}
          />
        )}
        {view.type === 'sessions' && <SessionsView search={search} onOpen={(id) => setView({ type: 'session', id })} />}
        {view.type === 'session' && <SessionReader id={view.id} onBack={() => setView({ type: 'sessions' })} />}
        {view.type === 'query-builder' && (
          <QueryBuilder
            onSaved={async (q) => { await refresh(); setView({ type: 'query', id: q.id }); }}
            onOpenSession={(id) => setView({ type: 'session', id })}
          />
        )}
        {view.type === 'query' && (
          <QueryView
            id={view.id}
            onBack={() => setView({ type: 'sessions' })}
            onOpenSession={(id) => setView({ type: 'session', id })}
            onDeleted={async () => { await refresh(); setView({ type: 'sessions' }); }}
          />
        )}
      </main>
    </div>
  );
}
