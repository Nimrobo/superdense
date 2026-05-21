import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerPluginsRoutes } from './routes/plugins.js';
import { registerGroupsRoutes } from './routes/groups.js';
import { registerReindexRoutes } from './routes/reindex.js';
import { registerStatsRoutes } from './routes/stats.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  webDist?: string;
}

export async function startServer(opts: ServerOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const app = Fastify({ logger: false });

  await registerSessionsRoutes(app);
  await registerPluginsRoutes(app);
  await registerGroupsRoutes(app);
  await registerReindexRoutes(app);
  await registerStatsRoutes(app);

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    opts.webDist,
    resolve(here, '../../web/dist'),
    resolve(here, '../../../web/dist'),
  ].filter(Boolean) as string[];
  const webDist = candidates.find((p) => existsSync(p));
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.status(404).send({ error: 'not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 0;
  const address = await app.listen({ host, port });
  return {
    url: address,
    close: async () => { await app.close(); },
  };
}
