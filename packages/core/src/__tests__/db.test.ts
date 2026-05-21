import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../paths.js', () => ({
  DB_PATH: ':memory:',
  ROAD42_HOME: '/tmp/road42-test',
  GROUPS_DIR: '/tmp/road42-test/queries',
  USER_PLUGINS_DIR: '/tmp/road42-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/road42-test/enrichers',
  ensureRoad42Dirs: vi.fn(),
}));

import {
  getDb,
  upsertSession,
  getSession,
  listSessions,
  countSessions,
  getDirtySessions,
  markIndexed,
  createQuery,
  listQueries,
  getQuery,
  deleteQuery,
  listQueryMatches,
  upsertQueryMatch,
  dropQueryMatch,
  markQueryRun,
  isQueryMatch,
  upsertEnrichment,
  getEnrichment,
  getStatsTotals,
  getMaxLastIndexedAt,
  getSessionsPerDay,
  getTopPwds,
  getTopQueries,
  getTopTools,
  listRecentSessions,
} from '../db.js';
import type { Session, Query } from '../types.js';
import type { Predicate } from '../query/types.js';

const BASE: Session = {
  id: 'sess-1',
  agent: 'claude-code',
  sessionId: 'abc123',
  logPath: '/tmp/logs/abc123.jsonl',
  pwd: '/home/user/project',
};

const PRED: Predicate = { plugin: { name: 'keyword', config: { keyword: 'react' } } };

const BASE_QUERY: Omit<Query, 'memberCount' | 'lastRunAt'> = {
  id: 'q1',
  name: 'Test Query',
  predicate: PRED,
  createdAt: 1000,
};

function clearDb() {
  const db = getDb();
  db.exec('DELETE FROM query_matches; DELETE FROM query_enrich; DELETE FROM sessions; DELETE FROM queries;');
}

describe('sessions', () => {
  beforeEach(clearDb);

  it('upserts and retrieves a session', () => {
    upsertSession(BASE);
    const got = getSession('sess-1');
    expect(got).not.toBeNull();
    expect(got!.id).toBe('sess-1');
    expect(got!.agent).toBe('claude-code');
    expect(got!.pwd).toBe('/home/user/project');
  });

  it('updates existing session on conflict', () => {
    upsertSession(BASE);
    upsertSession({ ...BASE, pwd: '/updated/path' });
    expect(getSession('sess-1')!.pwd).toBe('/updated/path');
  });

  it('returns null for unknown id', () => {
    expect(getSession('nonexistent')).toBeNull();
  });

  it('preserves isSidechain flag', () => {
    upsertSession({ ...BASE, isSidechain: true });
    expect(getSession('sess-1')!.isSidechain).toBe(true);
  });

  it('listSessions orders by modifiedAt desc', () => {
    upsertSession({ ...BASE, id: 's1', modifiedAt: 1000 });
    upsertSession({ ...BASE, id: 's2', modifiedAt: 2000 });
    const list = listSessions();
    expect(list[0].id).toBe('s2');
    expect(list[1].id).toBe('s1');
  });

  it('listSessions filters by agent', () => {
    upsertSession({ ...BASE, id: 's1', agent: 'agent-a' });
    upsertSession({ ...BASE, id: 's2', agent: 'agent-b' });
    const results = listSessions({ agent: 'agent-a' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s1');
  });

  it('listSessions filters by pwd', () => {
    upsertSession({ ...BASE, id: 's1', pwd: '/proj/a' });
    upsertSession({ ...BASE, id: 's2', pwd: '/proj/b' });
    const results = listSessions({ pwd: '/proj/a' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('s1');
  });

  it('listSessions filters by query text in firstPrompt', () => {
    upsertSession({ ...BASE, id: 's1', firstPrompt: 'fix the bug' });
    upsertSession({ ...BASE, id: 's2', firstPrompt: 'add feature' });
    expect(listSessions({ q: 'bug' })).toHaveLength(1);
    expect(listSessions({ q: 'feature' })[0].id).toBe('s2');
  });

  it('listSessions respects limit', () => {
    for (let i = 0; i < 5; i++) upsertSession({ ...BASE, id: `s${i}` });
    expect(listSessions({ limit: 3 })).toHaveLength(3);
  });

  it('listSessions respects offset', () => {
    for (let i = 0; i < 5; i++) upsertSession({ ...BASE, id: `s${i}`, modifiedAt: i });
    const p1 = listSessions({ limit: 2, offset: 0 });
    const p2 = listSessions({ limit: 2, offset: 2 });
    expect(p1[0].id).not.toBe(p2[0].id);
  });

  it('countSessions returns total', () => {
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });
    expect(countSessions()).toBe(2);
  });

  it('countSessions respects agent filter', () => {
    upsertSession({ ...BASE, id: 's1', agent: 'a' });
    upsertSession({ ...BASE, id: 's2', agent: 'b' });
    expect(countSessions({ agent: 'a' })).toBe(1);
  });

  it('getDirtySessions returns sessions with no lastIndexedAt', () => {
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2', lastIndexedAt: 1000, fileMtime: 500 });
    const dirty = getDirtySessions().map((s) => s.id);
    expect(dirty).toContain('s1');
    expect(dirty).not.toContain('s2');
  });

  it('getDirtySessions returns sessions where fileMtime > lastIndexedAt', () => {
    upsertSession({ ...BASE, id: 's1', lastIndexedAt: 900, fileMtime: 1000 });
    upsertSession({ ...BASE, id: 's2', lastIndexedAt: 1000, fileMtime: 500 });
    const dirty = getDirtySessions().map((s) => s.id);
    expect(dirty).toContain('s1');
    expect(dirty).not.toContain('s2');
  });

  it('markIndexed sets lastIndexedAt', () => {
    upsertSession(BASE);
    markIndexed('sess-1', 9999);
    expect(getSession('sess-1')!.lastIndexedAt).toBe(9999);
  });
});

describe('queries', () => {
  beforeEach(clearDb);

  it('creates and retrieves a query', () => {
    createQuery(BASE_QUERY);
    const got = getQuery('q1');
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Test Query');
    expect(got!.predicate).toEqual(PRED);
    expect(got!.memberCount).toBe(0);
  });

  it('returns null for unknown query', () => {
    expect(getQuery('nope')).toBeNull();
  });

  it('listQueries returns all queries ordered by createdAt desc', () => {
    createQuery({ ...BASE_QUERY, id: 'q1', createdAt: 1000 });
    createQuery({ ...BASE_QUERY, id: 'q2', name: 'Q2', createdAt: 2000 });
    const list = listQueries();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('q2');
  });

  it('deleteQuery removes the query', () => {
    createQuery(BASE_QUERY);
    deleteQuery('q1');
    expect(getQuery('q1')).toBeNull();
    expect(listQueries()).toHaveLength(0);
  });

  it('markQueryRun updates lastRunAt', () => {
    createQuery(BASE_QUERY);
    markQueryRun('q1', 7777);
    expect(getQuery('q1')!.lastRunAt).toBe(7777);
  });
});

describe('query matches', () => {
  beforeEach(clearDb);

  function setup() {
    createQuery(BASE_QUERY);
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });
  }

  it('upsertQueryMatch and isQueryMatch', () => {
    setup();
    upsertQueryMatch({ queryId: 'q1', sessionId: 's1', addedAt: 100 });
    expect(isQueryMatch('q1', 's1')).toBe(true);
    expect(isQueryMatch('q1', 's2')).toBe(false);
  });

  it('dropQueryMatch removes membership', () => {
    setup();
    upsertQueryMatch({ queryId: 'q1', sessionId: 's1', addedAt: 100 });
    dropQueryMatch('q1', 's1');
    expect(isQueryMatch('q1', 's1')).toBe(false);
  });

  it('listQueryMatches returns sessions in query', () => {
    setup();
    upsertQueryMatch({ queryId: 'q1', sessionId: 's1', addedAt: 100 });
    const members = listQueryMatches('q1');
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe('s1');
  });

  it('memberCount reflects current membership', () => {
    setup();
    upsertQueryMatch({ queryId: 'q1', sessionId: 's1', addedAt: 100 });
    upsertQueryMatch({ queryId: 'q1', sessionId: 's2', addedAt: 200 });
    expect(getQuery('q1')!.memberCount).toBe(2);
    dropQueryMatch('q1', 's1');
    expect(getQuery('q1')!.memberCount).toBe(1);
  });

  it('upsertQueryMatch is idempotent (updates evidence)', () => {
    setup();
    upsertQueryMatch({ queryId: 'q1', sessionId: 's1', addedAt: 100, evidence: 'first' });
    upsertQueryMatch({ queryId: 'q1', sessionId: 's1', addedAt: 200, evidence: 'second' });
    expect(getQuery('q1')!.memberCount).toBe(1);
  });

  it('deleteQuery cascades to query_matches', () => {
    setup();
    upsertQueryMatch({ queryId: 'q1', sessionId: 's1', addedAt: 100 });
    deleteQuery('q1');
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM query_matches').get()).toEqual({ c: 0 });
  });
});

describe('enrichments', () => {
  beforeEach(clearDb);

  it('upserts and retrieves an enrichment', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', 'event_count', 1, 42, 1000);
    const got = getEnrichment('sess-1', 'event_count');
    expect(got).not.toBeNull();
    expect(got!.value).toBe(42);
    expect(got!.version).toBe(1);
    expect(got!.computedAt).toBe(1000);
  });

  it('returns null for missing enrichment', () => {
    upsertSession(BASE);
    expect(getEnrichment('sess-1', 'nonexistent')).toBeNull();
  });

  it('updates version and value on conflict', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', 'event_count', 1, 42, 1000);
    upsertEnrichment('sess-1', 'event_count', 2, 99, 2000);
    const got = getEnrichment('sess-1', 'event_count');
    expect(got!.value).toBe(99);
    expect(got!.version).toBe(2);
    expect(got!.computedAt).toBe(2000);
  });

  it('stores and retrieves complex JSON values', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', 'tool_counts', 1, { bash: 3, read: 1 }, 1000);
    const got = getEnrichment('sess-1', 'tool_counts');
    expect(got!.value).toEqual({ bash: 3, read: 1 });
  });

  it('returns false boolean value correctly', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', 'has_errors', 1, false, 1000);
    const got = getEnrichment('sess-1', 'has_errors');
    expect(got!.value).toBe(false);
  });
});

describe('stats aggregates', () => {
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
    upsertQueryMatch({ queryId: 'q2', sessionId: 's1', addedAt: 1 });
    upsertQueryMatch({ queryId: 'q2', sessionId: 's2', addedAt: 2 });
    const tops = getTopQueries(5);
    expect(tops[0].name).toBe('Large');
    expect(tops[0].memberCount).toBe(2);
  });

  it('getTopTools aggregates tool_counts enrichments across sessions', () => {
    upsertSession({ ...BASE, id: 's1' });
    upsertSession({ ...BASE, id: 's2' });
    upsertEnrichment('s1', 'tool_counts', 1, { bash: 5, read: 2 }, 1000);
    upsertEnrichment('s2', 'tool_counts', 1, { bash: 3, write: 1 }, 1000);
    const tops = getTopTools(10);
    const bash = tops.find((t) => t.tool === 'bash');
    expect(bash?.count).toBe(8);
    expect(tops.find((t) => t.tool === 'read')?.count).toBe(2);
    expect(tops.find((t) => t.tool === 'write')?.count).toBe(1);
  });

  it('getTopTools respects limit', () => {
    upsertSession(BASE);
    upsertEnrichment('sess-1', 'tool_counts', 1, { a: 1, b: 2, c: 3, d: 4 }, 1000);
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
