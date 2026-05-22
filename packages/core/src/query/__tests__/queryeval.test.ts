import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  DB_PATH: ':memory:',
  ROAD42_HOME: '/tmp/road42-queryeval-test',
  GROUPS_DIR: '/tmp/road42-queryeval-test/queries',
  USER_FILTERS_DIR: '/tmp/road42-queryeval-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/road42-queryeval-test/plugins',
  USER_ENRICHERS_DIR: '/tmp/road42-queryeval-test/enrichers',
  ensureRoad42Dirs: vi.fn(),
}));

import { _resetDbForTests, getEnrichment, upsertSession } from '../../db.js';
import { clearEnricherCache, registerEnricher } from '../../enrichers/index.js';
import { clearFilterCache } from '../../filters/index.js';
import { previewQuery } from '../../queryeval.js';
import type { Session } from '../../types.js';

let tempDir: string | undefined;

beforeEach(async () => {
  _resetDbForTests();
  clearFilterCache();
  clearEnricherCache();
  tempDir = await mkdtemp(join(tmpdir(), 'road42-queryeval-'));
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

describe('previewQuery', () => {
  it('filters first, then runs requested enrichers only on matched sessions', async () => {
    const matchedLog = await writeCodexLog('matched.jsonl', 'Fix billing tests');
    const skippedLog = await writeCodexLog('skipped.jsonl', 'Write docs');
    upsertSession(session('matched', matchedLog));
    upsertSession(session('skipped', skippedLog));

    const run = vi.fn(async () => 'post-filter-data');
    registerEnricher({ name: 'post_marker', version: 1, returns: 'string', run });

    const result = await previewQuery({
      filters: { filter: { name: 'user_prompt_contains', params: { keyword: 'billing' } } },
      enrichers: ['post_marker'],
    });

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

    await expect(previewQuery({
      filters: { filter: { name: 'session', params: { agentt: 'codex' } } },
    })).rejects.toThrow('filter "session": unknown param "agentt"');
    expect(run).not.toHaveBeenCalled();
  });
});
