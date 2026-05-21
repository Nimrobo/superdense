export interface Session {
  id: string;
  agent: string;
  sessionId: string;
  logPath: string;
  pwd: string;
  firstPrompt?: string | null;
  summary?: string | null;
  messageCount?: number | null;
  gitBranch?: string | null;
  createdAt?: number | null;
  modifiedAt?: number | null;
}

export interface TranscriptEvent {
  ts?: number;
  toolName?: string;
  inputText?: string;
  role?: 'user' | 'assistant' | 'system';
  text?: string;
}

export interface PluginSchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description?: string;
  default?: string | number | boolean;
}

export interface PluginInfo {
  name: string;
  title: string;
  description?: string;
  configSchema: PluginSchemaField[];
}

export interface EnricherInfo {
  name: string;
  version: number;
  returns: 'string' | 'int' | 'bool' | 'json';
  jsonSchema?: object;
  description?: string;
}

export type Predicate =
  | { and: Predicate[] }
  | { or: Predicate[] }
  | { not: Predicate }
  | { field: string; op: string; value?: unknown; path?: string; intOp?: string }
  | { plugin: { name: string; config: Record<string, unknown> } };

export interface Query {
  id: string;
  name: string;
  predicate: Predicate;
  createdAt: number;
  lastRunAt?: number | null;
  memberCount?: number;
}

export interface Stats {
  totals: {
    sessions: number;
    sessionsLast7d: number;
    distinctPwds: number;
    distinctAgents: number;
    queries: number;
  };
  lastIndexedAt: number | null;
  perDay: Array<{ date: string; count: number }>;
  topPwds: Array<{ pwd: string; count: number }>;
  topQueries: Array<{ id: string; name: string; memberCount: number }>;
  topTools: Array<{ tool: string; count: number }>;
  recentSessions: Session[];
}

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  listSessions: (q: { q?: string; pwd?: string; limit?: number; offset?: number } = {}) => {
    const sp = new URLSearchParams();
    if (q.q) sp.set('q', q.q);
    if (q.pwd) sp.set('pwd', q.pwd);
    if (q.limit) sp.set('limit', String(q.limit));
    if (q.offset) sp.set('offset', String(q.offset));
    return j<{ items: Session[]; total: number }>(`/api/sessions?${sp}`);
  },
  getSession: (id: string) => j<Session>(`/api/sessions/${encodeURIComponent(id)}`),
  getTranscript: (id: string, opts: { offset?: number; limit?: number } = {}) => {
    const sp = new URLSearchParams();
    if (opts.offset) sp.set('offset', String(opts.offset));
    if (opts.limit) sp.set('limit', String(opts.limit));
    return j<{ items: TranscriptEvent[]; offset: number; limit: number }>(`/api/sessions/${encodeURIComponent(id)}/transcript?${sp}`);
  },
  listPlugins: () => j<{ items: PluginInfo[] }>('/api/plugins'),
  listEnrichers: () => j<{ items: EnricherInfo[] }>('/api/enrichers'),
  previewPlugin: (name: string, config: Record<string, unknown>, limit = 500) =>
    j<{ items: { sessionId: string; evidence?: string | null }[]; total: number }>(
      `/api/plugins/${encodeURIComponent(name)}/preview`,
      { method: 'POST', body: JSON.stringify({ config, limit }) },
    ),
  listQueries: () => j<{ items: Query[] }>('/api/queries'),
  getQuery: (id: string) => j<Query & { members: Session[] }>(`/api/queries/${encodeURIComponent(id)}`),
  createQuery: (q: { name: string; predicate: Predicate }) =>
    j<Query>('/api/queries', { method: 'POST', body: JSON.stringify(q) }),
  previewQuery: (predicate: Predicate, limit = 500) =>
    j<{ items: { sessionId: string; evidence?: string | null }[]; total: number; referencedEnrichers: string[]; missingEnrichments: string[] }>(
      '/api/queries/preview',
      { method: 'POST', body: JSON.stringify({ predicate, limit }) },
    ),
  runQuery: (id: string) => j<{ matched: number }>(`/api/queries/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  deleteQuery: (id: string) => j<{ ok: true }>(`/api/queries/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reindex: (full = false) => j<{ ok: boolean }>(`/api/reindex${full ? '?full=1' : ''}`, { method: 'POST' }),
  progress: () => j<{ phase: string; total: number; done: number }>('/api/progress'),
  stats: () => j<Stats>('/api/stats'),
};
