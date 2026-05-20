import type { FastifyInstance } from 'fastify';
import { loadPlugins, previewPlugin } from '@road42/core';

export async function registerPluginsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/plugins', async () => {
    const plugins = await loadPlugins();
    return {
      items: plugins.map((p) => ({
        name: p.name,
        title: p.title,
        description: p.description,
        configSchema: p.configSchema ?? [],
      })),
    };
  });

  app.post('/api/plugins/:name/preview', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { config?: Record<string, unknown>; limit?: number };
    try {
      const items = await previewPlugin(name, body.config ?? {}, { limit: body.limit });
      return { items, total: items.length };
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }
  });
}
