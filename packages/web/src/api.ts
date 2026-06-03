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
  kind?: 'text' | 'tool_call' | 'tool_result' | 'mode_change';
  toolCallId?: string;
  toolName?: string;
  inputText?: string;
  role?: 'user' | 'assistant' | 'system';
  text?: string;
  isError?: boolean;
  mode?: string;
  prevMode?: string;
}

export interface EnricherInfo {
  name: string;
  version: number;
  returns: 'string' | 'int' | 'bool' | 'json';
  jsonSchema?: object;
  description?: string;
}

export type CompactorName = 'trace' | 'salience';

export interface CompactorInfo {
  name: CompactorName;
  kind: string;
  targetBytes: number | null;
  description?: string | null;
}

export interface SessionCompactorResponse {
  session: Session;
  compactor: CompactorInfo;
  result: unknown;
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
  repeatedReturnProjects: Array<{
    pwd: string;
    activeDays: number;
    sessions: number;
    lastActiveAt: number;
  }>;
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
  comebackProjects: Array<{
    pwd: string;
    dormantDays: number;
    resumedAt: number;
    sessions7d: number;
  }>;
  dayKinds: Array<{
    date: string;
    sessions: number;
    pwds: number;
    kind: 'focus' | 'scatter' | 'normal';
  }>;
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

export type ProjectStatus = 'unprofiled' | 'profiled' | 'covered';

export type ArtifactDetector =
  | { kind: 'folder-leaf'; include: string[]; exclude?: string[] }
  | { kind: 'file-glob'; include: string[]; exclude?: string[] }
  | { kind: 'branch' }
  | { kind: 'whole-surface' };

export interface ArtifactShape {
  type: string;
  detector: ArtifactDetector;
  outputHint?: { globs: string[]; note?: string };
}

export interface ProjectSummary {
  id: string;
  projectKey: string;
  status: ProjectStatus;
  coveredBy: string | null;
  name: string | null;
  description: string | null;
  roots: string[];
  artifactShapes: ArtifactShape[];
  evidenceSummary: string[];
  notes: string | null;
  needsHumanAttention: boolean;
  attentionReasons: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  profiledAt: number | null;
  updatedAt: number;
}

export interface Project extends ProjectSummary {
  coveredProjects: ProjectSummary[];
}

export type ThreadLifecycle = 'open' | 'ready' | 'artifact';
export type WorkThreadRole = 'contributor' | 'evidence';

export interface WorkThreadSession {
  sessionId: string;
  role: WorkThreadRole;
  rationale: string | null;
}

export interface WorkThreadLineageEvent {
  id: string;
  sessionId: string;
  eventType: 'attach' | 'retract';
  role: WorkThreadRole;
  rationale: string | null;
  createdAt: number;
}

export interface WorkThread {
  id: string;
  projectProfileId: string;
  provisionalTitle: string;
  summary: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  artifactType: string | null;
  payload: Record<string, unknown> | null;
  artifactFinalizedAt: number | null;
  readyAt: number | null;
  readinessRationale: string | null;
  predecessorArtifactId: string | null;
  lifecycle: ThreadLifecycle;
  headSessionId?: string | null;
  sessions?: WorkThreadSession[];
  lineageEvents?: WorkThreadLineageEvent[];
}

// A ready work thread becomes a Layer 3B artifact when its stable payload is set.
export type Artifact = WorkThread;

export interface ExternalizationTarget {
  id: string;
  artifactId: string;
  connector: string;
  status: 'linked' | 'needs_connector' | 'not_found' | 'ambiguous';
  locator: string | null;
  evidence: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactExternalization {
  artifactId: string;
  status: 'unprocessed' | 'not_external' | 'linked' | 'blocked';
  conclusion: 'not_external' | 'external' | null;
  evidence: string | null;
  updatedAt: number | null;
  targets: ExternalizationTarget[];
}

export interface RewardSnapshot {
  id: string;
  targetId: string;
  capturedAt: number;
  metrics: Record<string, number>;
  primaryDim: string | null;
  source: string | null;
  evidence: string | null;
  createdAt: number;
}

export interface RewardTargetSeries {
  targetId: string;
  connector: string;
  locator: string | null;
  latest: RewardSnapshot | null;
  snapshots: RewardSnapshot[];
}

export interface ArtifactRewards {
  artifactId: string;
  targets: RewardTargetSeries[];
}

export type CohortAxis = 'type' | 'connector';

export interface CohortSummary {
  type: string;
  connector: string | null;
  artifactCount: number;
  externalizedCount: number;
  withRewardsCount: number;
}

export interface CohortMember {
  artifact: Artifact;
  externalization: ArtifactExternalization | null;
  rewards: ArtifactRewards;
}

export interface Cohort {
  type: string;
  connector: string | null;
  projectId: string | null;
  members: CohortMember[];
}

export interface VersionChainSummary {
  rootId: string;
  type: string;
  length: number;
}

export interface VersionChain {
  rootId: string;
  type: string;
  members: CohortMember[];
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
    return j<{ items: TranscriptEvent[]; offset: number; limit: number }>(
      `/api/sessions/${encodeURIComponent(id)}/transcript?${sp}`,
    );
  },
  runSessionCompactor: (id: string, name: CompactorName) =>
    j<SessionCompactorResponse>(`/api/sessions/${encodeURIComponent(id)}/compactors/${name}`),
  listEnrichers: () => j<{ items: EnricherInfo[] }>('/api/enrichers'),
  listFilters: () => j<{ items: FilterInfo[] }>('/api/filters'),
  listFacets: () => j<{ pwd: string[]; agent: string[]; project: string[] }>('/api/facets'),
  listQueries: () => j<{ items: Query[] }>('/api/saved-queries'),
  getQuery: (id: string) =>
    j<Query & { members: Session[] }>(`/api/saved-queries/${encodeURIComponent(id)}`),
  createQuery: (q: { name: string } & QueryDefinition) =>
    j<Query>('/api/saved-queries', { method: 'POST', body: JSON.stringify(q) }),
  executeQuery: (definition: QueryDefinition, limit = 500, offset = 0) =>
    j<{
      items: {
        sessionId: string;
        evidence?: string | null;
        enrichments?: Record<string, unknown>;
      }[];
      total: number;
      matched: number;
      limit: number;
      offset: number;
      enrichers: string[];
    }>('/api/query', { method: 'POST', body: JSON.stringify({ ...definition, limit, offset }) }),
  previewQuery: (definition: QueryDefinition, limit = 500) =>
    j<{
      items: {
        sessionId: string;
        evidence?: string | null;
        enrichments?: Record<string, unknown>;
      }[];
      total: number;
      matched: number;
      limit: number;
      offset: number;
      enrichers: string[];
    }>('/api/query', { method: 'POST', body: JSON.stringify({ ...definition, limit, offset: 0 }) }),
  runQuery: (id: string) =>
    j<{
      matched: number;
      items: {
        sessionId: string;
        evidence?: string | null;
        enrichments?: Record<string, unknown>;
      }[];
    }>(`/api/saved-queries/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  deleteQuery: (id: string) =>
    j<{ ok: true }>(`/api/saved-queries/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reindex: (full = false) =>
    j<{ ok: boolean }>(`/api/reindex${full ? '?full=1' : ''}`, { method: 'POST' }),
  progress: () => j<{ phase: string; total: number; done: number }>('/api/progress'),
  stats: () => j<Stats>('/api/stats'),
  statsHeader: () => j<HeaderStats>('/api/stats/header'),
  statsWindow: (days: 7 | 14 | 30) => j<WindowBundle>(`/api/stats/window?days=${days}`),
  statsInsights: () => j<Insights>('/api/stats/insights'),
  insightsRecipes: () => j<{ items: InsightRecipe[] }>('/api/insights/recipes'),
  insightsPrompt: async (name: string): Promise<{ prompt: string; runId: string | null }> => {
    const res = await fetch(`/api/insights/recipes/${encodeURIComponent(name)}/prompt`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const prompt = await res.text();
    return { prompt, runId: res.headers.get('x-superdense-run-id') };
  },
  insightsRuns: () => j<{ items: InsightRun[] }>('/api/insights/runs'),
  listProjects: (opts: { needsAction?: boolean } = {}) =>
    j<{ items: ProjectSummary[] }>(`/api/projects${opts.needsAction ? '?needsAction=true' : ''}`),
  getProject: (id: string) =>
    j<{ project: Project; redirectedFrom: string | null }>(
      `/api/projects/${encodeURIComponent(id)}`,
    ),
  setProjectAttention: (id: string, needed: boolean, reasons?: string[]) =>
    j<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}/attention`, {
      method: 'PATCH',
      body: JSON.stringify({ needed, ...(reasons ? { reasons } : {}) }),
    }),
  listArtifacts: (opts: { projectId?: string; type?: string } = {}) => {
    const sp = new URLSearchParams();
    if (opts.projectId) sp.set('projectId', opts.projectId);
    if (opts.type) sp.set('type', opts.type);
    const qs = sp.toString();
    return j<{ items: Artifact[] }>(`/api/artifacts${qs ? `?${qs}` : ''}`);
  },
  getArtifact: (id: string) =>
    j<{ artifact: Artifact }>(`/api/artifacts/${encodeURIComponent(id)}`),
  listThreads: (opts: { projectId?: string; lifecycle?: ThreadLifecycle } = {}) => {
    const sp = new URLSearchParams();
    if (opts.projectId) sp.set('projectId', opts.projectId);
    if (opts.lifecycle) sp.set('lifecycle', opts.lifecycle);
    const qs = sp.toString();
    return j<{ items: WorkThread[] }>(`/api/threads${qs ? `?${qs}` : ''}`);
  },
  getThread: (id: string) => j<{ thread: WorkThread }>(`/api/threads/${encodeURIComponent(id)}`),
  listCohorts: (opts: { projectId?: string; by?: CohortAxis } = {}) => {
    const sp = new URLSearchParams();
    if (opts.projectId) sp.set('projectId', opts.projectId);
    if (opts.by) sp.set('by', opts.by);
    const qs = sp.toString();
    return j<{ items: CohortSummary[] }>(`/api/cohorts${qs ? `?${qs}` : ''}`);
  },
  getCohort: (type: string, opts: { connector?: string; projectId?: string } = {}) => {
    const sp = new URLSearchParams();
    if (opts.connector) sp.set('connector', opts.connector);
    if (opts.projectId) sp.set('projectId', opts.projectId);
    const qs = sp.toString();
    return j<{ cohort: Cohort }>(`/api/cohorts/${encodeURIComponent(type)}${qs ? `?${qs}` : ''}`);
  },
  listVersionChains: (opts: { projectId?: string } = {}) => {
    const sp = new URLSearchParams();
    if (opts.projectId) sp.set('projectId', opts.projectId);
    const qs = sp.toString();
    return j<{ items: VersionChainSummary[] }>(`/api/cohorts/chains${qs ? `?${qs}` : ''}`);
  },
  getVersionChain: (artifactId: string) =>
    j<{ chain: VersionChain }>(`/api/cohorts/chains/${encodeURIComponent(artifactId)}`),
};

export interface InsightRecipe {
  name: string;
  title: string;
  description: string;
  file: string;
}

export interface InsightRun {
  sessionId: string;
  insightName: string;
  insightTitle: string;
  runId: string;
  timestamp: number | null;
  project: string;
  agent: string;
  answerExcerpt: string | null;
  hasAnswer: boolean;
}
