import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@nimrobo/superdense-core', () => ({
  getWorkThread: vi.fn(),
  listWorkThreads: vi.fn(),
}));

import * as core from '@nimrobo/superdense-core';
import { registerThreadsRoutes } from '../routes/threads.js';

async function buildApp() {
  const app = Fastify();
  await registerThreadsRoutes(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(core.listWorkThreads).mockReturnValue([]);
  vi.mocked(core.getWorkThread).mockReturnValue(null);
});

describe('thread routes', () => {
  it('lists threads without filters', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/threads' });
    expect(response.statusCode).toBe(200);
    expect(core.listWorkThreads).toHaveBeenCalledWith({
      projectId: undefined,
      lifecycle: undefined,
    });
  });

  it('filters lists by project and lifecycle', async () => {
    const app = await buildApp();
    for (const lifecycle of ['open', 'finalized', 'artifact'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/threads?projectId=p1&lifecycle=${lifecycle}`,
      });
      expect(response.statusCode).toBe(200);
      expect(core.listWorkThreads).toHaveBeenLastCalledWith({ projectId: 'p1', lifecycle });
    }
  });

  it('rejects invalid lifecycle values', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/threads?lifecycle=draft' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'lifecycle must be open, finalized, or artifact' });
  });

  it('returns a thread detail or 404', async () => {
    vi.mocked(core.getWorkThread).mockReturnValueOnce({ id: 't1' } as never);
    const app = await buildApp();
    const found = await app.inject({ method: 'GET', url: '/api/threads/t1' });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toEqual({ thread: { id: 't1' } });

    const missing = await app.inject({ method: 'GET', url: '/api/threads/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not found' });
  });
});
