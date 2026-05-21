import type { FastifyInstance } from 'fastify';
import { clearPluginCache, getProgress, runDiscovery, runQueryEvaluation } from '@road42/core';

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
        clearPluginCache();
        await runDiscovery();
        await runQueryEvaluation({ full });
      } catch (err) {
        console.error('[road42] reindex failed:', err);
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
