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

import { _resetDbForTests, countQueryMatches, createQuery, getEnrichment, getQuery, upsertSession } from '../../db.js';
import { clearEnricherCache, registerEnricher } from '../../enrichers/index.js';
import { clearFilterCache } from '../../filters/index.js';
import { previewQuery, runAdHocQuery } from '../../queryeval.js';
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
  await writeFile(path, [
    JSON.stringify({ timestamp: '2026-05-21T04:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: userText }] } }),
    JSON.stringify({ timestamp: '2026-05-21T04:00:03.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] } }),
  ].join('\n'), 'utf8');
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
    expect(result.items).toEqual([expect.objectContaining({
      sessionId: 'codex:matched',
      evidence: 'Fix billing tests',
      enrichments: { post_marker: 'post-filter-data' },
    })]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(getEnrichment('codex:skipped', 'post_marker')).toBeNull();
  });

  it('rejects invalid filter params before processing sessions', async () => {
    const log = await writeCodexLog('matched.jsonl', 'Fix billing tests');
    upsertSession(session('matched', log));

    const run = vi.fn(async () => 'always-data');
    registerEnricher({ name: 'always_marker', version: 1, returns: 'string', alwaysRun: true, run });

    await expect(runAdHocQuery({
      filters: { filter: { name: 'session', params: { agentt: 'codex' } } },
    })).rejects.toThrow('filter "session": unknown param "agentt"');
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

    const result = await runAdHocQuery({
      filters: { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
    }, { limit: 1, offset: 1 });

    expect(result).toMatchObject({ matched: 2, total: 2, limit: 1, offset: 1 });
    expect(result.items).toHaveLength(1);
    expect(getQuery('saved')).toMatchObject({ memberCount: 0 });
    expect(countQueryMatches('saved')).toBe(0);
  });

  it('keeps previewQuery as a compatibility wrapper', async () => {
    const log = await writeCodexLog('matched.jsonl', 'Fix billing tests');
    upsertSession(session('matched', log));

    const result = await previewQuery({
      filters: { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
    }, { limit: 1 });

    expect(result.items).toEqual([expect.objectContaining({ sessionId: 'codex:matched' })]);
    expect(result.enrichers).toEqual([]);
  });
});
