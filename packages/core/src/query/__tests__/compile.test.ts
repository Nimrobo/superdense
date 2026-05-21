import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  ROAD42_HOME: '/tmp/road42-query-test',
  GROUPS_DIR: '/tmp/road42-query-test/queries',
  USER_PLUGINS_DIR: '/tmp/road42-query-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/road42-query-test/enrichers',
  ensureRoad42Dirs: vi.fn(),
}));

import { _resetDbForTests, getDb, upsertEnrichment, upsertSession } from '../../db.js';
import { compilePredicate } from '../compile.js';
import type { Predicate } from '../types.js';

const session = {
  id: 's1',
  agent: 'claude-code',
  sessionId: 'abc',
  logPath: '/tmp/abc.jsonl',
  pwd: '/repo/app',
  projectKey: '/repo/app',
  firstPrompt: 'Fix errors',
  summary: 'Summary',
  messageCount: 12,
  gitBranch: 'main',
  createdAt: 1000,
  modifiedAt: 2000,
  isSidechain: false,
};

beforeEach(() => {
  _resetDbForTests();
});

describe('compilePredicate', () => {
  it('compiles scalar session operators with bound params', () => {
    const compiled = compilePredicate({ field: 'session.pwd', op: 'startsWith', value: '/repo' });
    expect(compiled.sql).toContain('s.pwd LIKE @p0');
    expect(compiled.params.p0).toBe('/repo%');
  });

  it('compiles in and between operators', () => {
    const inPredicate = compilePredicate({ field: 'session.agent', op: 'in', value: ['a', 'b'] });
    expect(inPredicate.sql).toContain('s.agent IN (@p0, @p1)');
    expect(inPredicate.params).toMatchObject({ p0: 'a', p1: 'b' });

    const betweenPredicate = compilePredicate({ field: 'session.messageCount', op: 'between', value: [1, 3] });
    expect(betweenPredicate.sql).toContain('s.message_count BETWEEN @p0 AND @p1');
  });

  it('compiles enricher scalar fields through query_enrich JSON values', () => {
    const compiled = compilePredicate({ field: 'enr.event_count', op: '>', value: 5 });
    expect(compiled.sql).toContain('LEFT JOIN query_enrich qe_0');
    expect(compiled.sql).toContain("json_extract(qe_0.value, @p0) > @p1");
    expect(compiled.referencedEnrichers).toEqual(['event_count']);
  });

  it('compiles JSON path operators', () => {
    const compiled = compilePredicate({ field: 'enr.tool_counts', op: 'jsonEq', path: '$.Bash', value: 4 });
    expect(compiled.sql).toContain('json_extract(qe_0.value, @p0) = @p1');
    expect(compiled.params.p0).toBe('$.Bash');
  });

  it('compiles jsonAny over arrays', () => {
    const compiled = compilePredicate({ field: 'enr.tool_counts', op: 'jsonAny', path: '$.Bash', intOp: '>', value: 5 });
    expect(compiled.sql).toContain('EXISTS (SELECT 1 FROM json_each(qe_0.value, @p0) je WHERE je.value > @p1)');
  });

  it('combines and/or/not with stable precedence', () => {
    const predicate: Predicate = {
      and: [
        { field: 'session.pwd', op: 'contains', value: 'repo' },
        { or: [
          { field: 'session.messageCount', op: '>', value: 10 },
          { not: { field: 'session.isSidechain', op: '=', value: true } },
        ] },
      ],
    };
    const compiled = compilePredicate(predicate);
    expect(compiled.sql).toContain('WHERE (s.pwd LIKE @p0 AND (s.message_count > @p1 OR NOT (s.is_sidechain = @p2)))');
  });

  it('runs compiled SQL against sessions and query_enrich rows', () => {
    upsertSession(session);
    upsertSession({ ...session, id: 's2', pwd: '/other', messageCount: 1 });
    upsertEnrichment('s1', 'tool_counts', 1, { Bash: [1, 6] }, 3000);
    upsertEnrichment('s2', 'tool_counts', 1, { Bash: [1] }, 3000);

    const compiled = compilePredicate({
      and: [
        { field: 'session.pwd', op: 'startsWith', value: '/repo' },
        { field: 'enr.tool_counts', op: 'jsonAny', path: '$.Bash', intOp: '>', value: 5 },
      ],
    });
    const rows = getDb().prepare(compiled.sql).all(compiled.params) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(['s1']);
  });

  it('marks legacy plugin leaves for JS evaluation', () => {
    const compiled = compilePredicate({ plugin: { name: 'by-pwd', config: { pwd: '/repo' } } });
    expect(compiled.containsPluginLeaf).toBe(true);
    expect(compiled.sql).toContain('WHERE 0');
  });
});
