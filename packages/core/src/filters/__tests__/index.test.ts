import { mkdir, rm, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../paths.js', () => ({
  USER_FILTERS_DIR: '/tmp/superdense-filter-test/filters',
  LEGACY_USER_FILTERS_DIR: '/tmp/superdense-filter-test/plugins',
}));

import { clearFilterCache, listFilterCatalog, loadFilters } from '../index.js';

const root = '/tmp/superdense-filter-test';
const filtersDir = `${root}/filters`;
const pluginsDir = `${root}/plugins`;

beforeEach(async () => {
  clearFilterCache();
  await rm(root, { recursive: true, force: true });
  await mkdir(filtersDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true });
});

describe('filters registry', () => {
  it('lists built-in filters in the catalog', async () => {
    const catalog = await listFilterCatalog();
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'session', title: 'Session' }),
        expect.objectContaining({ name: 'user_prompt_contains', readsLog: true }),
      ]),
    );
  });

  it('loads a user filter from ~/.superdense/filters', async () => {
    await writeFile(
      `${filtersDir}/custom.mjs`,
      `
      export default {
        name: 'custom_log_filter',
        title: 'Custom Log Filter',
        paramsSchema: { type: 'object', properties: { needle: { type: 'string' } } },
        async run() { return true; }
      };
    `,
      'utf8',
    );

    clearFilterCache();
    const filters = await loadFilters();

    expect(filters.map((f) => f.name)).toContain('custom_log_filter');
  });

  it('adapts legacy matcher modules as filters', async () => {
    await writeFile(
      `${pluginsDir}/legacy.mjs`,
      `
      export default {
        name: 'legacy_keyword',
        title: 'Legacy Keyword',
        configSchema: [{ name: 'keyword', type: 'string', required: true }],
        async matches() { return { match: true, evidence: 'ok' }; }
      };
    `,
      'utf8',
    );

    clearFilterCache();
    const filter = (await loadFilters()).find((f) => f.name === 'legacy_keyword');
    const result = await filter?.run(
      {
        session: {
          id: 's1',
          agent: 'codex',
          sessionId: 's1',
          logPath: '/tmp/x',
          pwd: '/repo',
          projectKey: '/repo',
        },
        logPath: '/tmp/x',
        iterEvents: async function* () {},
        getSystemEnrichment: () => null,
      },
      { keyword: 'x' },
    );

    expect(result).toEqual({ match: true, evidence: 'ok' });
  });
});
