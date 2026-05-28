import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-subagent-summary-test',
  GROUPS_DIR: '/tmp/superdense-subagent-summary-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-subagent-summary-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-subagent-summary-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-subagent-summary-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import { _resetDbForTests, upsertSession, upsertSessionLink } from '../../db.js';
import { subagentSummaryEnricher } from '../subagent-summary.js';
import type { Session } from '../../types.js';

const base: Session = {
  id: 'root',
  agent: 'codex',
  sessionId: 'root',
  logPath: '/tmp/root.jsonl',
  pwd: '/repo',
  projectKey: '/repo',
};

beforeEach(() => {
  _resetDbForTests();
});

function makeCtx(session: Session) {
  return {
    session,
    logPath: session.logPath,
    async *iterEvents() {},
  };
}

describe('subagentSummaryEnricher', () => {
  it('summarizes direct children, descendants, root, and depth', async () => {
    const root = base;
    const child = { ...base, id: 'child', sessionId: 'child', isSubagent: true };
    const grandchild = { ...base, id: 'grandchild', sessionId: 'grandchild', isSubagent: true };
    upsertSession(root);
    upsertSession({ ...child, parentSessionId: 'root' });
    upsertSession({ ...grandchild, parentSessionId: 'child' });
    upsertSessionLink('root', 'child', 'subagent', null, 1000);
    upsertSessionLink('child', 'grandchild', 'subagent', null, 1001);

    await expect(subagentSummaryEnricher.run(makeCtx(root))).resolves.toEqual({
      v: 1,
      hasSubagents: true,
      subagentCount: 1,
      subagentIds: ['child'],
      descendantSubagentCount: 2,
      subagentDepth: 0,
      rootSessionId: 'root',
      ancestorSessionIds: [],
    });
    await expect(subagentSummaryEnricher.run(makeCtx(child))).resolves.toEqual({
      v: 1,
      hasSubagents: true,
      subagentCount: 1,
      subagentIds: ['grandchild'],
      descendantSubagentCount: 1,
      subagentDepth: 1,
      rootSessionId: 'root',
      ancestorSessionIds: ['root'],
    });
  });
});
