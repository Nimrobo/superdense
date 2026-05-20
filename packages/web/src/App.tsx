import { useEffect, useState } from 'react';
import { api, type Group, type PluginInfo } from './api.js';
import { Sidebar } from './components/Sidebar.js';
import { SessionsView } from './components/SessionsView.js';
import { SessionReader } from './components/SessionReader.js';
import { PluginRunner } from './components/PluginRunner.js';
import { GroupView } from './components/GroupView.js';

export type View =
  | { type: 'sessions' }
  | { type: 'session'; id: string }
  | { type: 'plugin'; name: string }
  | { type: 'group'; id: string };

export function App() {
  const [view, setView] = useState<View>({ type: 'sessions' });
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<{ phase: string; total: number; done: number } | null>(null);

  const refresh = async () => {
    const [p, g] = await Promise.all([api.listPlugins(), api.listGroups()]);
    setPlugins(p.items);
    setGroups(g.items);
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
        plugins={plugins}
        groups={groups}
        search={search}
        setSearch={setSearch}
        progress={progress}
        onReindex={doReindex}
      />
      <main className="work">
        {view.type === 'sessions' && <SessionsView search={search} onOpen={(id) => setView({ type: 'session', id })} />}
        {view.type === 'session' && <SessionReader id={view.id} onBack={() => setView({ type: 'sessions' })} />}
        {view.type === 'plugin' && (
          <PluginRunner
            plugin={plugins.find((p) => p.name === view.name)!}
            onSaved={async (g) => { await refresh(); setView({ type: 'group', id: g.id }); }}
            onOpenSession={(id) => setView({ type: 'session', id })}
          />
        )}
        {view.type === 'group' && (
          <GroupView
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
