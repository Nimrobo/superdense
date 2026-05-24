import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  createQuery: vi.fn(),
  deleteQuery: vi.fn(),
  getQuery: vi.fn(),
  listEnrichers: vi.fn(),
  listFilterCatalog: vi.fn(),
  listFilters: vi.fn(),
  listQueryMatches: vi.fn(),
  listQueries: vi.fn(),
  loadUserEnrichers: vi.fn(),
  previewQuery: vi.fn(),
  runAdHocQuery: vi.fn(),
  runSavedQuery: vi.fn(),
  validateQueryDefinition: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import { registerQueriesRoutes } from '../routes/queries.js';

const definition = {
  filters: { filter: { name: 'session', params: { agent: 'codex' } } },
  enrichers: [],
};

async function buildApp() {
  const app = Fastify();
  await registerQueriesRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(core.listFilters).mockResolvedValue([
    { name: 'session', title: 'Session', paramsSchema: {}, run: vi.fn() },
  ]);
  vi.mocked(core.listEnrichers).mockReturnValue([]);
  vi.mocked(core.listQueries).mockReturnValue([]);
  vi.mocked(core.listQueryMatches).mockReturnValue([]);
  vi.mocked(core.getQuery).mockReturnValue({
    id: 'q1',
    name: 'Saved',
    filters: definition.filters,
    enrichers: [],
    createdAt: 1,
    lastRunAt: null,
    memberCount: 0,
  });
  vi.mocked(core.runAdHocQuery).mockResolvedValue({
    matched: 1,
    total: 1,
    limit: 20,
    offset: 0,
    items: [{ sessionId: 'codex:abc123', evidence: 'matched', enrichments: {} }],
    enrichers: [],
  });
  vi.mocked(core.runSavedQuery).mockResolvedValue({
    matched: 1,
    items: [{ sessionId: 'codex:abc123', evidence: 'matched', enrichments: {} }],
  });
});

describe('query routes', () => {
  it('runs ad hoc queries through /api/query', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/query',
      payload: { ...definition, limit: 20, offset: 0 },
    });

    expect(res.statusCode).toBe(200);
    expect(core.validateQueryDefinition).toHaveBeenCalledWith(definition, {
      filters: await core.listFilters(),
      enrichers: core.listEnrichers(),
    });
    expect(core.runAdHocQuery).toHaveBeenCalledWith(definition, { limit: 20, offset: 0 });
    expect(core.createQuery).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({ matched: 1, total: 1 });
  });

  it('saves saved queries without running them', async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/saved-queries',
      payload: { name: 'Saved', ...definition },
    });

    expect(res.statusCode).toBe(200);
    expect(core.createQuery).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Saved',
      filters: definition.filters,
      enrichers: [],
    }));
    expect(core.runSavedQuery).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({ id: 'q1', name: 'Saved' });
  });

  it('runs saved queries through the saved-query alias', async () => {
    const app = await buildApp();

    const res = await app.inject({ method: 'POST', url: '/api/saved-queries/q1/run' });

    expect(res.statusCode).toBe(200);
    expect(core.runSavedQuery).toHaveBeenCalledWith('q1');
    expect(res.json()).toMatchObject({ matched: 1 });
  });
});
