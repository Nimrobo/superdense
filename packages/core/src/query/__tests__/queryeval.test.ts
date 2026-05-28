import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  SUPERDENSE_HOME: '/tmp/superdense-queryeval-test',
  GROUPS_DIR: '/tmp/superdense-queryeval-test/queries',
  USER_FILTERS_DIR: '/tmp/superdense-queryeval-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-queryeval-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/superdense-queryeval-test/enrichers',
  ensureSuperdenseDirs: vi.fn(),
}));

import {
  _resetDbForTests,
  countQueryMatches,
  createQuery,
  getQuery,
  listSessionEnrichments,
  listStandaloneRuns,
  upsertSession,
  upsertSessionLink,
} from '../../db.js';
import { clearEnricherCache, registerEnricher } from '../../enrichers/index.js';
import { clearFilterCache } from '../../filters/index.js';
import { previewQuery, runAdHocQuery, runSavedQuery } from '../../queryeval.js';
import type { Session } from '../../types.js';

let tempDir: string | undefined;

beforeEach(async () => {
  _resetDbForTests();
  clearFilterCache();
  clearEnricherCache();
  tempDir = await mkdtemp(join(tmpdir(), 'superdense-queryeval-'));
});

afterEach(async () => {
  clearFilterCache();
  clearEnricherCache();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

async function writeCodexLog(name: string, userText: string): Promise<string> {
  const path = join(tempDir!, name);
  await writeFile(
    path,
    [
      JSON.stringify({
        timestamp: '2026-05-21T04:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: userText }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-21T04:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'ok' }],
        },
      }),
    ].join('\n'),
    'utf8',
  );
  return path;
}

function session(id: string, logPath: string): Session {
  return {
    id: `codex:${id}`,
    agent: 'codex',
    sessionId: id,
    logPath,
    pwd: '/repo',
    projectKey: '/repo',
    firstPrompt: null,
    summary: null,
  };
}

describe('runAdHocQuery', () => {
  it('filters first, then runs requested enrichers only on matched sessions', async () => {
    const matchedLog = await writeCodexLog('matched.jsonl', 'Fix billing tests');
    const skippedLog = await writeCodexLog('skipped.jsonl', 'Write docs');
    upsertSession(session('matched', matchedLog));
    upsertSession(session('skipped', skippedLog));

    const run = vi.fn(async () => 'post-filter-data');
    registerEnricher({ name: 'post_marker', version: 1, returns: 'string', run });

    const result = await runAdHocQuery({
      filters: { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
      enrichers: ['post_marker'],
    });

    expect(result).toMatchObject({ matched: 1, total: 1, limit: 500, offset: 0 });
    expect(result.items).toEqual([
      expect.objectContaining({
        sessionId: 'codex:matched',
        evidence: 'Fix billing tests',
        enrichments: { post_marker: 'post-filter-data' },
      }),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(listSessionEnrichments('codex:skipped').some((e) => e.name === 'post_marker')).toBe(
      false,
    );
    // The matched session has the enrichment, scoped to the standalone run.
    const runs = listStandaloneRuns();
    expect(runs).toHaveLength(1);
    expect(
      listSessionEnrichments('codex:matched', runs[0]!.id).find((e) => e.name === 'post_marker')
        ?.value,
    ).toBe('post-filter-data');
  });

  it('rejects invalid filter params before processing sessions', async () => {
    const log = await writeCodexLog('matched.jsonl', 'Fix billing tests');
    upsertSession(session('matched', log));

    const run = vi.fn(async () => 'always-data');
    registerEnricher({
      name: 'always_marker',
      version: 1,
      returns: 'string',
      alwaysRun: true,
      run,
    });

    await expect(
      runAdHocQuery({
        filters: { filter: { name: 'session', params: { agentt: 'codex' } } },
      }),
    ).rejects.toThrow('filter "session": unknown param "agentt"');
    expect(run).not.toHaveBeenCalled();
  });

  it('paginates without saving query memberships', async () => {
    const firstLog = await writeCodexLog('first.jsonl', 'Fix billing one');
    const secondLog = await writeCodexLog('second.jsonl', 'Fix billing two');
    upsertSession(session('first', firstLog));
    upsertSession(session('second', secondLog));
    createQuery({
      id: 'saved',
      name: 'Saved',
      filters: { filter: { name: 'session', params: { agent: 'codex' } } },
      enrichers: [],
      createdAt: 1,
    });

    const result = await runAdHocQuery(
      {
        filters: { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
      },
      { limit: 1, offset: 1 },
    );

    expect(result).toMatchObject({ matched: 2, total: 2, limit: 1, offset: 1 });
    expect(result.items).toHaveLength(1);
    expect(getQuery('saved')).toMatchObject({ memberCount: 0 });
    expect(countQueryMatches('saved')).toBe(0);
  });

  it('keeps previewQuery as a compatibility wrapper', async () => {
    const log = await writeCodexLog('matched.jsonl', 'Fix billing tests');
    upsertSession(session('matched', log));

    const result = await previewQuery(
      {
        filters: { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
      },
      { limit: 1 },
    );

    expect(result.items).toEqual([expect.objectContaining({ sessionId: 'codex:matched' })]);
    expect(result.enrichers).toEqual([]);
  });

  it('defaults non-session filters to root sessions for ad-hoc and saved queries', async () => {
    const rootLog = await writeCodexLog('root.jsonl', 'Fix billing root');
    const childLog = await writeCodexLog('child.jsonl', 'Fix billing child');
    upsertSession(session('root', rootLog));
    upsertSession({
      ...session('child', childLog),
      isSubagent: true,
      parentSessionId: 'codex:root',
    });

    const filters = { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } };

    await expect(runAdHocQuery({ filters })).resolves.toMatchObject({
      matched: 1,
      items: [expect.objectContaining({ sessionId: 'codex:root' })],
    });

    createQuery({
      id: 'saved-root-default',
      name: 'Saved root default',
      filters,
      enrichers: [],
      createdAt: 1,
    });
    await expect(runSavedQuery('saved-root-default')).resolves.toMatchObject({
      matched: 1,
      items: [expect.objectContaining({ sessionId: 'codex:root' })],
    });
  });

  it('lets session includeSubagents apply to sibling filters in the same and branch', async () => {
    const rootLog = await writeCodexLog('root.jsonl', 'Fix billing root');
    const childLog = await writeCodexLog('child.jsonl', 'Fix billing child');
    upsertSession(session('root', rootLog));
    upsertSession({
      ...session('child', childLog),
      isSubagent: true,
      parentSessionId: 'codex:root',
    });

    const result = await runAdHocQuery({
      filters: {
        and: [
          { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
          { filter: { name: 'session', params: { includeSubagents: true } } },
        ],
      },
    });

    expect(result.matched).toBe(2);
    expect(result.items.map((item) => item.sessionId).sort()).toEqual([
      'codex:child',
      'codex:root',
    ]);
  });

  it('keeps includeSubagents scoped to its or branch', async () => {
    const rootBillingLog = await writeCodexLog('root-billing.jsonl', 'Fix billing root');
    const childBillingLog = await writeCodexLog('child-billing.jsonl', 'Fix billing child');
    const rootRefundLog = await writeCodexLog('root-refund.jsonl', 'Fix refund root');
    const childRefundLog = await writeCodexLog('child-refund.jsonl', 'Fix refund child');
    upsertSession(session('root-billing', rootBillingLog));
    upsertSession({
      ...session('child-billing', childBillingLog),
      isSubagent: true,
      parentSessionId: 'codex:root-billing',
    });
    upsertSession(session('root-refund', rootRefundLog));
    upsertSession({
      ...session('child-refund', childRefundLog),
      isSubagent: true,
      parentSessionId: 'codex:root-refund',
    });

    const result = await runAdHocQuery({
      filters: {
        or: [
          {
            and: [
              { filter: { name: 'session', params: { includeSubagents: true } } },
              { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
            ],
          },
          { filter: { name: 'user_prompt_contains', params: { keyword: 'refund' } } },
        ],
      },
    });

    expect(result.matched).toBe(3);
    expect(result.items.map((item) => item.sessionId).sort()).toEqual([
      'codex:child-billing',
      'codex:root-billing',
      'codex:root-refund',
    ]);
  });

  it('treats nested and includeSubagents like a flattened and', async () => {
    const rootLog = await writeCodexLog('root.jsonl', 'Fix billing root');
    const childLog = await writeCodexLog('child.jsonl', 'Fix billing child');
    upsertSession(session('root', rootLog));
    upsertSession({
      ...session('child', childLog),
      isSubagent: true,
      parentSessionId: 'codex:root',
    });

    const result = await runAdHocQuery({
      filters: {
        and: [
          {
            and: [{ filter: { name: 'session', params: { includeSubagents: true } } }],
          },
          { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
        ],
      },
    });

    expect(result.matched).toBe(2);
    expect(result.items.map((item) => item.sessionId).sort()).toEqual([
      'codex:child',
      'codex:root',
    ]);
  });

  it('does not let includeSubagents inside nested or scope sibling and filters', async () => {
    const rootBillingLog = await writeCodexLog('root-billing.jsonl', 'Fix billing root');
    const childBillingLog = await writeCodexLog('child-billing.jsonl', 'Fix billing child');
    upsertSession(session('root-billing', rootBillingLog));
    upsertSession({
      ...session('child-billing', childBillingLog),
      isSubagent: true,
      parentSessionId: 'codex:root-billing',
    });

    const result = await runAdHocQuery({
      filters: {
        and: [
          {
            or: [
              { filter: { name: 'session', params: { includeSubagents: true } } },
              { filter: { name: 'session', params: { agent: 'codex' } } },
            ],
          },
          { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
        ],
      },
    });

    expect(result.matched).toBe(1);
    expect(result.items).toEqual([expect.objectContaining({ sessionId: 'codex:root-billing' })]);
  });

  it('defaults session filters to roots while allowing sub-agent and parent queries', async () => {
    const rootLog = await writeCodexLog('root.jsonl', 'Root work');
    const childLog = await writeCodexLog('child.jsonl', 'Child work');
    upsertSession(session('root', rootLog));
    upsertSession({
      ...session('child', childLog),
      isSubagent: true,
      parentSessionId: 'codex:root',
    });

    await expect(
      runAdHocQuery({ filters: { filter: { name: 'session', params: {} } } }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ sessionId: 'codex:root' })],
      matched: 1,
    });

    await expect(
      runAdHocQuery({
        filters: { filter: { name: 'session', params: { isSubagent: true } } },
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ sessionId: 'codex:child' })],
      matched: 1,
    });

    const all = await runAdHocQuery({
      filters: { filter: { name: 'session', params: { includeSubagents: true } } },
    });
    expect(all.matched).toBe(2);
    expect(all.items.map((item) => item.sessionId).sort()).toEqual(['codex:child', 'codex:root']);

    await expect(
      runAdHocQuery({
        filters: { filter: { name: 'session', params: { parent: 'codex:root' } } },
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ sessionId: 'codex:child' })],
      matched: 1,
    });
  });

  it('filters sessions by always-on sub-agent summary metadata', async () => {
    const rootLog = await writeCodexLog('root.jsonl', 'Root work');
    const childLog = await writeCodexLog('child.jsonl', 'Child work');
    const grandchildLog = await writeCodexLog('grandchild.jsonl', 'Grandchild work');
    upsertSession(session('root', rootLog));
    upsertSession({
      ...session('child', childLog),
      isSubagent: true,
      parentSessionId: 'codex:root',
    });
    upsertSession({
      ...session('grandchild', grandchildLog),
      isSubagent: true,
      parentSessionId: 'codex:child',
    });
    upsertSessionLink('codex:root', 'codex:child', 'subagent', null, 1000);
    upsertSessionLink('codex:child', 'codex:grandchild', 'subagent', null, 1001);

    await expect(
      runAdHocQuery({ filters: { filter: { name: 'session', params: { hasSubagents: true } } } }),
    ).resolves.toMatchObject({
      matched: 1,
      items: [expect.objectContaining({ sessionId: 'codex:root' })],
    });

    await expect(
      runAdHocQuery({
        filters: {
          filter: {
            name: 'session',
            params: {
              isSubagent: true,
              hasSubagents: true,
              subagentDepth: { op: '=', value: 1 },
            },
          },
        },
      }),
    ).resolves.toMatchObject({
      matched: 1,
      items: [expect.objectContaining({ sessionId: 'codex:child' })],
    });

    await expect(
      runAdHocQuery({
        filters: {
          filter: {
            name: 'session',
            params: {
              rootSession: 'codex:root',
              descendantSubagentCount: { op: '>=', value: 2 },
            },
          },
        },
      }),
    ).resolves.toMatchObject({
      matched: 1,
      items: [expect.objectContaining({ sessionId: 'codex:root' })],
    });

    const tree = await runAdHocQuery({
      filters: { filter: { name: 'session', params: { rootSession: 'codex:root' } } },
    });
    expect(tree.matched).toBe(3);
    expect(tree.items.map((item) => item.sessionId).sort()).toEqual([
      'codex:child',
      'codex:grandchild',
      'codex:root',
    ]);
  });
});
