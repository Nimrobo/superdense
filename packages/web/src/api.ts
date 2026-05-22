export interface Session {
  id: string;
  agent: string;
  sessionId: string;
  logPath: string;
  pwd: string;
  projectKey: string;
  firstPrompt?: string | null;
  summary?: string | null;
  messageCount?: number | null;
  gitBranch?: string | null;
  createdAt?: number | null;
  modifiedAt?: number | null;
}

export interface TranscriptEvent {
  ts?: number;
  kind?: 'text' | 'tool_call' | 'tool_result';
  toolCallId?: string;
  toolName?: string;
  inputText?: string;
  role?: 'user' | 'assistant' | 'system';
  text?: string;
}

export interface EnricherInfo {
  name: string;
  version: number;
  returns: 'string' | 'int' | 'bool' | 'json';
  jsonSchema?: object;
  description?: string;
}

export type QueryFilter =
  | { and: QueryFilter[] }
  | { or: QueryFilter[] }
  | { not: QueryFilter }
  | { filter: { name: string; params: Record<string, unknown> } };

export interface QueryDefinition {
  filters: QueryFilter;
  enrichers?: string[];
}

export interface FilterInfo {
  name: string;
  title: string;
  description?: string;
  paramsSchema: object;
  examples?: QueryFilter[];
  readsLog?: boolean;
  usesSystemData?: boolean;
}

export interface Query {
  id: string;
  name: string;
  filters: QueryFilter;
  enrichers: string[];
  createdAt: number;
  lastRunAt?: number | null;
  memberCount?: number;
}

export interface HeaderStats {
  totals: { sessions: number; distinctPwds: number; activeDays: number; distinctAgents: number };
  streaks: {
    current: number;
    longest: number;
    longestRange: { start: string; end: string } | null;
  };
  contributions: Array<{ date: string; count: number }>;
  lastIndexedAt: number | null;
  recentSessions: Session[];
  topPwds: Array<{ pwd: string; count: number }>;
}

export interface WindowMetrics {
  sessions: number;
  projects: number;
  activeDays: number;
  avgPerActiveDay: number;
  adapterMix: Array<{ agent: string; count: number }>;
  topClis: Array<{ cli: string; count: number }>;
  activeProjects: Array<{ pwd: string; count: number; activeDays: number; lastActiveAt: number }>;
  repeatedReturnProjects: Array<{ pwd: string; activeDays: number; sessions: number; lastActiveAt: number }>;
}

export interface WindowBundle {
  days: number;
  window: WindowMetrics;
}

export interface Insights {
  hourDowHeatmap: Array<{ dow: number; hour: number; count: number }>;
  workRhythm: {
    peakHour: { dow: number; hour: number; count: number } | null;
    mostConsistentWeekday: { dow: number; activeWeeks: number } | null;
  };
  comebackProjects: Array<{ pwd: string; dormantDays: number; resumedAt: number; sessions7d: number }>;
  dayKinds: Array<{ date: string; sessions: number; pwds: number; kind: 'focus' | 'scatter' | 'normal' }>;
  personalRecords: {
    bestDay: { date: string; sessions: number } | null;
    mostCliInSession: { sessionId: string; total: number } | null;
    longestSession: { sessionId: string; durationMs: number } | null;
  };
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
  listEnrichers: () => j<{ items: EnricherInfo[] }>('/api/enrichers'),
  listFilters: () => j<{ items: FilterInfo[] }>('/api/filters'),
  listFacets: () => j<{ pwd: string[]; agent: string[] }>('/api/facets'),
  listQueries: () => j<{ items: Query[] }>('/api/queries'),
  getQuery: (id: string) => j<Query & { members: Session[] }>(`/api/queries/${encodeURIComponent(id)}`),
  createQuery: (q: { name: string } & QueryDefinition) =>
    j<Query>('/api/queries', { method: 'POST', body: JSON.stringify(q) }),
  previewQuery: (definition: QueryDefinition, limit = 500) =>
    j<{ items: { sessionId: string; evidence?: string | null; enrichments?: Record<string, unknown> }[]; total: number; enrichers: string[] }>(
      '/api/queries/preview',
      { method: 'POST', body: JSON.stringify({ ...definition, limit }) },
    ),
  runQuery: (id: string) => j<{ matched: number; items: { sessionId: string; evidence?: string | null; enrichments?: Record<string, unknown> }[] }>(`/api/queries/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  deleteQuery: (id: string) => j<{ ok: true }>(`/api/queries/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reindex: (full = false) => j<{ ok: boolean }>(`/api/reindex${full ? '?full=1' : ''}`, { method: 'POST' }),
  progress: () => j<{ phase: string; total: number; done: number }>('/api/progress'),
  stats: () => j<Stats>('/api/stats'),
  statsHeader: () => j<HeaderStats>('/api/stats/header'),
  statsWindow: (days: 7 | 14 | 30) => j<WindowBundle>(`/api/stats/window?days=${days}`),
  statsInsights: () => j<Insights>('/api/stats/insights'),
};
