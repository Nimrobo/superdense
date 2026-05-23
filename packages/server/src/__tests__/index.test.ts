import { describe, expect, it, vi } from 'vitest';

vi.mock('../routes/sessions.js', () => ({
  registerSessionsRoutes: vi.fn(async () => {}),
}));
vi.mock('../routes/facets.js', () => ({
  registerFacetsRoutes: vi.fn(async () => {}),
}));
vi.mock('../routes/queries.js', () => ({
  registerQueriesRoutes: vi.fn(async () => {}),
}));
vi.mock('../routes/reindex.js', () => ({
  registerReindexRoutes: vi.fn(async () => {}),
}));
vi.mock('../routes/stats.js', () => ({
  registerStatsRoutes: vi.fn(async () => {}),
}));
vi.mock('../routes/insights.js', () => ({
  registerInsightsRoutes: vi.fn(async () => {}),
}));

import { startServer } from '../index.js';

function portFromUrl(url: string): number {
  return Number(new URL(url).port);
}

describe('startServer', () => {
  it('falls forward when the requested port is occupied and fallback is enabled', async () => {
    const blocker = await startServer({ host: '127.0.0.1', port: 0 });
    const port = portFromUrl(blocker.url);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;

    try {
      server = await startServer({ host: '127.0.0.1', port, portFallbackAttempts: 50 });

      expect(portFromUrl(server.url)).toBeGreaterThan(port);
    } finally {
      await server?.close();
      await blocker.close();
    }
  });

  it('rejects when the requested port is occupied and fallback is disabled', async () => {
    const blocker = await startServer({ host: '127.0.0.1', port: 0 });
    const port = portFromUrl(blocker.url);

    try {
      await expect(startServer({ host: '127.0.0.1', port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await blocker.close();
    }
  });

  it('does not swallow non-address-in-use listen errors', async () => {
    await expect(startServer({
      host: 'not-a-real-road42-host.invalid',
      port: 4242,
      portFallbackAttempts: 1,
    })).rejects.not.toMatchObject({ code: 'EADDRINUSE' });
  });
});
