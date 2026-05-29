import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-test',
  GROUPS_DIR: '/tmp/superdense-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import {
  SYSTEM_RUN_ID,
  createQuery,
  createQueryRun,
  finishQueryRun,
  getDb,
  upsertEnrichment,
  upsertQueryMatch,
  upsertSession,
} from '../../db.js';
import type { QueryFilter } from '../../query/types.js';
import type { Query, Session } from '../../types.js';
import {
  getMaxLastIndexedAt,
  getSessionsPerDay,
  getStatsTotals,
  getTopPwds,
  getTopQueries,
  getTopTools,
  listRecentSessions,
} from '../dashboard.js';

const BASE: Session = {
  id: 'sess-1',
  agent: 'claude-code',
  sessionId: 'abc123',
  logPath: '/tmp/logs/abc123.jsonl',
  pwd: '/home/user/project',
  projectKey: '/home/user/project',
};

const FILTERS: QueryFilter = { filter: { name: 'session', params: { agent: 'claude-code' } } };

const BASE_QUERY: Omit<Query, 'memberCount' | 'lastRunAt'> = {
  id: 'q1',
  name: 'Test Query',
  filters: FILTERS,
  enrichers: [],
  createdAt: 1000,
};

function clearDb() {
  getDb().exec(
    "DELETE FROM query_matches; DELETE FROM session_enrich; DELETE FROM session_links; DELETE FROM sessions; DELETE FROM queries; DELETE FROM query_run WHERE id != 'system';",
  );
}

function makeRunFor(savedQueryId: string): string {
  const id = createQueryRun({
    savedQueryId,
    dsl: { filters: { and: [] }, enrichers: [] },
    startedAt: Date.now(),
  });
  finishQueryRun(id, { finishedAt: Date.now(), matchedCount: 0 });
  return id;
}

describe('dashboard stats aggregates', () => {
  beforeEach(clearDb);

  it('getStatsTotals returns zeros on empty db', () => {
    const totals = getStatsTotals();
    expect(totals.sessions).toBe(0);
    expect(totals.sessionsLast7d).toBe(0);
    expect(totals.distinctPwds).toBe(0);
    expect(totals.distinctAgents).toBe(0);
    expect(totals.queries).toBe(0);
  });

  it('getStatsTotals counts sessions, agents, pwds, and queries', () => {
    upsertSession({ ...BASE, id: 's1', agent: 'a', pwd: '/x' });
    upsertSession({ ...BASE, id: 's2', agent: 'b', pwd: '/y' });
    createQuery(BASE_QUERY);
    const totals = getStatsTotals();
    expect(totals.sessions).toBe(2);
    expect(totals.distinctAgents).toBe(2);
    expect(totals.distinctPwds).toBe(2);
    expect(totals.queries).toBe(1);
  });

  it('dashboard aggregates ignore sub-agent sessions', () => {
    const ts = new Date('2025-01-15').getTime();
    upsertSession({
      ...BASE,
      id: 'root',
      agent: 'root-agent',
      pwd: '/root',
      modifiedAt: ts,
      lastIndexedAt: 100,
    });
    upsertSession({
      ...BASE,
      id: 'child',
      agent: 'child-agent',
      pwd: '/child',
      modifiedAt: ts + 1000,
      isSubagent: true,
      parentSessionId: 'root',
      lastIndexedAt: 999,
    });
    createQuery(BASE_QUERY);
    upsertEnrichment('root', SYSTEM_RUN_ID, 'tool_counts', 1, { bash: 1, read: 2 }, ts);
    upsertEnrichment('child', SYSTEM_RUN_ID, 'tool_counts', 1, { bash: 10, write: 4 }, ts);

    const totals = getStatsTotals(ts + 2000);
    expect(totals).toEqual({
      sessions: 1,
      sessionsLast7d: 1,
      distinctPwds: 1,
      distinctAgents: 1,
      queries: 1,
    });
    expect(getMaxLastIndexedAt()).toBe(100);
    expect(getSessionsPerDay(30).find((d) => d.date === '2025-01-15')?.count).toBe(1);
    expect(getTopPwds(5)).toEqual([{ pwd: '/root', count: 1 }]);
    expect(listRecentSessions(5).map((s) => s.id)).toEqual(['root']);
    expect(Object.fromEntries(getTopTools(10).map((t) => [t.tool, t.count]))).toEqual({
      read: 2,
      bash: 1,
    });
  });

  it('getStatsTotals counts Conductor sibling workspaces as one project', () => {
    upsertSession({ ...BASE, id: 's1', pwd: '/Users/x/conductor/workspaces/superdense/provo-v1' });
    upsertSession({
      ...BASE,
      id: 's2',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v2/packages/core',
    });
    upsertSession({ ...BASE, id: 's3', pwd: '/Users/x/conductor/workspaces/other/provo-v1' });

    expect(getStatsTotals().distinctPwds).toBe(2);
  });

  it('sessionsLast7d counts only sessions modified within 7 days', () => {
    const now = Date.now();
    upsertSession({ ...BASE, id: 's1', modifiedAt: now - 1000 });
    upsertSession({ ...BASE, id: 's2', modifiedAt: now - 8 * 24 * 60 * 60 * 1000 });
    const totals = getStatsTotals(now);
    expect(totals.sessionsLast7d).toBe(1);
  });

  it('getMaxLastIndexedAt returns null for empty db', () => {
    expect(getMaxLastIndexedAt()).toBeNull();
  });

  it('getMaxLastIndexedAt returns the highest value', () => {
    upsertSession({ ...BASE, id: 's1', lastIndexedAt: 100 });
    upsertSession({ ...BASE, id: 's2', lastIndexedAt: 999 });
    upsertSession({ ...BASE, id: 's3' });
    expect(getMaxLastIndexedAt()).toBe(999);
  });

  it('getTopPwds ranks by session count', () => {
    upsertSession({ ...BASE, id: 's1', pwd: '/a' });
    upsertSession({ ...BASE, id: 's2', pwd: '/a' });
    upsertSession({ ...BASE, id: 's3', pwd: '/b' });
    const tops = getTopPwds(5);
    expect(tops[0]).toEqual({ pwd: '/a', count: 2 });
    expect(tops[1]).toEqual({ pwd: '/b', count: 1 });
  });

  it('getTopPwds groups Conductor sibling workspaces by projectKey', () => {
    upsertSession({ ...BASE, id: 's1', pwd: '/Users/x/conductor/workspaces/superdense/provo-v1' });
    upsertSession({
      ...BASE,
      id: 's2',
      pwd: '/Users/x/conductor/workspaces/superdense/provo-v2/packages/core',
    });
    upsertSession({ ...BASE, id: 's3', pwd: '/Users/x/conductor/workspaces/other/provo-v1' });

    const tops = getTopPwds(5);

    expect(tops[0]).toEqual({ pwd: '/Users/x/conductor/workspaces/superdense', count: 2 });
    expect(tops[1]).toEqual({ pwd: '/Users/x/conductor/workspaces/other', count: 1 });
  });

  it('getTopPwds respects limit', () => {
    for (let i = 0; i < 5; i++) upsertSession({ ...BASE, id: `s${i}`, pwd: `/p${i}` });
    expect(getTopPwds(3)).toHaveLength(3);
  });

  it('listRecentSessions returns sessions ordered by modifiedAt desc', () => {
    upsertSession({ ...BASE, id: 's1', modifiedAt: 100 });
    upsertSession({ ...BASE, id: 's2', modifiedAt: 200 });
    upsertSession({ ...BASE, id: 's3', modifiedAt: 300 });
    const recent = listRecentSessions(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe('s3');
    expect(recent[1].id).toBe('s2');
  });

  it('getTopQueries ranks by member count', () => {
    createQuery({ ...BASE_QUERY, id: 'q1', name: 'Small' });
    createQuery({ ...BASE_QUERY, id: 'q2', name: 'Large', createdAt: 2000 });
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });
    const q2Run = makeRunFor('q2');
    upsertQueryMatch({ queryRunId: q2Run, sessionId: 's1', addedAt: 1 });
    upsertQueryMatch({ queryRunId: q2Run, sessionId: 's2', addedAt: 2 });
    const tops = getTopQueries(5);
    expect(tops[0].name).toBe('Large');
    expect(tops[0].memberCount).toBe(2);
  });

  it('getTopTools aggregates tool_counts enrichments across sessions', () => {
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });
    upsertEnrichment('s1', SYSTEM_RUN_ID, 'tool_counts', 1, { bash: 5, read: 2 }, 1000);
    upsertEnrichment('s2', SYSTEM_RUN_ID, 'tool_counts', 1, { bash: 3, write: 1 }, 1000);
    const tops = getTopTools(10);
    const bash = tops.find((t) => t.tool === 'bash');
    expect(bash?.count).toBe(8);
    expect(tops.find((t) => t.tool === 'read')?.count).toBe(2);
    expect(tops.find((t) => t.tool === 'write')?.count).toBe(1);
  });

  it('getTopTools respects limit', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', SYSTEM_RUN_ID, 'tool_counts', 1, { a: 1, b: 2, c: 3, d: 4 }, 1000);
    expect(getTopTools(2)).toHaveLength(2);
  });

  it('getSessionsPerDay groups sessions by date', () => {
    const ts = new Date('2025-01-15').getTime();
    upsertSession({ ...BASE, id: 's1', modifiedAt: ts });
    upsertSession({ ...BASE, id: 's2', modifiedAt: ts + 1000 });
    const perDay = getSessionsPerDay(30);
    const day = perDay.find((d) => d.date === '2025-01-15');
    expect(day?.count).toBe(2);
  });
});
