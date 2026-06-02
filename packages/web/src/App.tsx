import { useEffect, useState } from 'react';
import { api, type Query } from './api.js';
import { Sidebar } from './components/Sidebar.js';
import { SessionsView } from './components/SessionsView.js';
import { SessionReader } from './components/SessionReader.js';
import { QueryView } from './components/QueryView.js';
import { QueryBuilder } from './components/QueryBuilder.js';
import { DashboardView } from './components/DashboardView.js';
import { InsightsView } from './components/InsightsView.js';
import { ProjectsView } from './components/ProjectsView.js';
import { ProjectView } from './components/ProjectView.js';
import { ArtifactsView } from './components/ArtifactsView.js';
import { ArtifactView } from './components/ArtifactView.js';
import { WorkThreadsView } from './components/WorkThreadsView.js';
import { WorkThreadView } from './components/WorkThreadView.js';

export type View =
  | { type: 'dashboard' }
  | { type: 'insights' }
  | { type: 'sessions' }
  | { type: 'projects' }
  | { type: 'project'; id: string }
  | { type: 'threads'; projectId?: string }
  | { type: 'thread'; id: string; projectId?: string }
  | { type: 'artifacts' }
  | { type: 'artifact'; id: string }
  | { type: 'session'; id: string }
  | { type: 'query-builder' }
  | { type: 'query'; id: string };

function parseHash(): View | null {
  const prefix = '#session=';
  if (!window.location.hash.startsWith(prefix)) return null;

  const rawId = window.location.hash.slice(prefix.length);
  if (!rawId) return null;

  try {
    return { type: 'session', id: decodeURIComponent(rawId) };
  } catch {
    return null;
  }
}

export function App() {
  const [view, setView] = useState<View>({ type: 'dashboard' });
  const [queries, setQueries] = useState<Query[]>([]);
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<{ phase: string; total: number; done: number } | null>(
    null,
  );

  const pushView = (next: View) => {
    window.history.pushState({ view: next }, '');
    setView(next);
  };

  const refresh = async () => {
    const q = await api.listQueries();
    setQueries(q.items);
  };

  useEffect(() => {
    const initialView = parseHash() ?? ({ type: 'dashboard' } satisfies View);
    setView(initialView);
    window.history.replaceState({ view: initialView }, '');
    const onPop = (e: PopStateEvent) => {
      const v = (e.state && (e.state as { view?: View }).view) as View | undefined;
      if (v) setView(v);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      api
        .progress()
        .then((p) => setProgress(p))
        .catch(() => {});
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
        setView={pushView}
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
            onOpenSession={(id) => pushView({ type: 'session', id })}
            onOpenSessions={() => pushView({ type: 'sessions' })}
            onOpenProject={(id) => pushView({ type: 'project', id })}
          />
        )}
        {view.type === 'insights' && (
          <InsightsView onOpenSession={(id) => pushView({ type: 'session', id })} />
        )}
        {view.type === 'sessions' && (
          <SessionsView search={search} onOpen={(id) => pushView({ type: 'session', id })} />
        )}
        {view.type === 'projects' && (
          <ProjectsView onOpen={(id) => pushView({ type: 'project', id })} />
        )}
        {view.type === 'project' && (
          <ProjectView id={view.id} onBack={() => window.history.back()} />
        )}
        {view.type === 'threads' && (
          <WorkThreadsView
            projectId={view.projectId}
            onProjectChange={(projectId) => pushView({ type: 'threads', projectId })}
            onOpen={(id) => pushView({ type: 'thread', id, projectId: view.projectId })}
          />
        )}
        {view.type === 'thread' && (
          <WorkThreadView
            id={view.id}
            onBack={() => window.history.back()}
            onOpenSession={(id) => pushView({ type: 'session', id })}
          />
        )}
        {view.type === 'artifacts' && (
          <ArtifactsView onOpen={(id) => pushView({ type: 'artifact', id })} />
        )}
        {view.type === 'artifact' && (
          <ArtifactView
            id={view.id}
            onBack={() => window.history.back()}
            onOpenSession={(id) => pushView({ type: 'session', id })}
          />
        )}
        {view.type === 'session' && (
          <SessionReader id={view.id} onBack={() => window.history.back()} />
        )}
        {view.type === 'query-builder' && (
          <QueryBuilder
            onSaved={async (q) => {
              await refresh();
              pushView({ type: 'query', id: q.id });
            }}
          />
        )}
        {view.type === 'query' && (
          <QueryView
            id={view.id}
            onBack={() => window.history.back()}
            onDeleted={async () => {
              await refresh();
              pushView({ type: 'sessions' });
            }}
          />
        )}
      </main>
    </div>
  );
}
