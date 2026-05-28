import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAdapter = vi.hoisted(() => ({
  name: 'mock-agent',
  discover: vi.fn(),
  discoverSubAgentSessions: vi.fn(),
  iterEvents: vi.fn(),
  sourceMtime: vi.fn(),
}));

vi.mock('../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-indexer-test',
  GROUPS_DIR: '/tmp/superdense-indexer-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-indexer-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-indexer-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-indexer-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

vi.mock('../adapters/index.js', () => ({
  adapters: [mockAdapter],
  getAdapter: vi.fn(),
  iterSessionEvents: vi.fn(async function* () {}),
}));

import {
  SYSTEM_RUN_ID,
  _resetDbForTests,
  getEnrichment,
  getSession,
  getSessionChildren,
  getSessionTree,
} from '../db.js';
import { clearEnricherCache } from '../enrichers/index.js';
import { runDiscovery } from '../indexer.js';

beforeEach(() => {
  _resetDbForTests();
  clearEnricherCache();
  mockAdapter.discover.mockReset();
  mockAdapter.discoverSubAgentSessions.mockReset();
  mockAdapter.iterEvents.mockReset();
  mockAdapter.sourceMtime.mockReset();
  mockAdapter.sourceMtime.mockResolvedValue(undefined);
});

describe('runDiscovery sub-agent indexing', () => {
  it('indexes roots first, then recursively indexes child sessions and links', async () => {
    mockAdapter.discover.mockResolvedValue([
      {
        sessionId: 'root',
        logPath: '/tmp/root.jsonl',
        pwd: '/repo',
        firstPrompt: 'Root prompt',
        modifiedAt: 1000,
      },
    ]);
    mockAdapter.discoverSubAgentSessions.mockImplementation(async (parentSessionId: string) => {
      if (parentSessionId === 'root') {
        return [
          {
            relation: 'subagent',
            metadata: { agent_role: 'explorer' },
            session: {
              sessionId: 'child',
              logPath: '/tmp/child.jsonl',
              pwd: '/repo',
              firstPrompt: 'Child prompt',
              modifiedAt: 1100,
            },
          },
        ];
      }
      if (parentSessionId === 'child') {
        return [
          {
            relation: 'subagent',
            metadata: { depth: 2 },
            session: {
              sessionId: 'grandchild',
              logPath: '/tmp/grandchild.jsonl',
              pwd: '/repo',
              firstPrompt: 'Grandchild prompt',
              modifiedAt: 1200,
            },
          },
        ];
      }
      return [];
    });

    await expect(runDiscovery()).resolves.toEqual({ discovered: 3 });

    expect(getSession('mock-agent:root')).toMatchObject({
      isSubagent: false,
      parentSessionId: null,
    });
    expect(getSession('mock-agent:child')).toMatchObject({
      isSubagent: true,
      parentSessionId: 'mock-agent:root',
    });
    expect(getSession('mock-agent:grandchild')).toMatchObject({
      isSubagent: true,
      parentSessionId: 'mock-agent:child',
    });
    expect(getSessionChildren('mock-agent:root')).toEqual([
      {
        childId: 'mock-agent:child',
        parentId: 'mock-agent:root',
        relation: 'subagent',
        metadata: { agent_role: 'explorer' },
      },
    ]);
    expect(getSessionTree('mock-agent:root', 2).children[0]!.children).toEqual([
      { id: 'mock-agent:grandchild', relation: 'subagent', children: [] },
    ]);
    expect(getEnrichment('mock-agent:root', SYSTEM_RUN_ID, 'subagent_summary')?.value).toEqual({
      v: 1,
      hasSubagents: true,
      subagentCount: 1,
      subagentIds: ['mock-agent:child'],
      descendantSubagentCount: 2,
      subagentDepth: 0,
      rootSessionId: 'mock-agent:root',
      ancestorSessionIds: [],
    });
    expect(getEnrichment('mock-agent:child', SYSTEM_RUN_ID, 'subagent_summary')?.value).toEqual({
      v: 1,
      hasSubagents: true,
      subagentCount: 1,
      subagentIds: ['mock-agent:grandchild'],
      descendantSubagentCount: 1,
      subagentDepth: 1,
      rootSessionId: 'mock-agent:root',
      ancestorSessionIds: ['mock-agent:root'],
    });
  });
});
