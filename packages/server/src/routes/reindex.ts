import type { FastifyInstance } from 'fastify';
import {
  clearFilterCache,
  getProgress,
  runDiscovery,
  runQueryEvaluation,
} from '@nimrobo/superdense-core';

let running = false;

export async function registerReindexRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/progress', async () => getProgress());

  app.post('/api/reindex', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const full = q.full === '1' || q.full === 'true';
    if (running) return { ok: false, error: 'already running', progress: getProgress() };
    running = true;
    (async () => {
      try {
        clearFilterCache();
        await runDiscovery();
        await runQueryEvaluation({ full });
      } catch (err) {
        console.error('[superdense] reindex failed:', err);
      } finally {
        running = false;
      }
    })();
    return { ok: true };
  });

  app.post('/api/discover', async () => {
    if (running) return { ok: false, error: 'busy' };
    running = true;
    try {
      const r = await runDiscovery();
      return { ok: true, ...r };
    } finally {
      running = false;
    }
  });
}
