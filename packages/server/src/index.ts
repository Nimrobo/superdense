import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerFacetsRoutes } from './routes/facets.js';
import { registerQueriesRoutes } from './routes/queries.js';
import { registerReindexRoutes } from './routes/reindex.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerInsightsRoutes } from './routes/insights.js';
import { registerProjectsRoutes } from './routes/projects.js';
import { registerArtifactsRoutes } from './routes/artifacts.js';
import { registerThreadsRoutes } from './routes/threads.js';
import { registerCohortsRoutes } from './routes/cohorts.js';
import { registerRewardRoutes } from './routes/reward.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  webDist?: string;
  portFallbackAttempts?: number;
}

function isAddressInUseError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'EADDRINUSE'
  );
}

async function buildApp(opts: ServerOptions) {
  const app = Fastify({ logger: false });

  await registerSessionsRoutes(app);
  await registerFacetsRoutes(app);
  await registerQueriesRoutes(app);
  await registerReindexRoutes(app);
  await registerStatsRoutes(app);
  await registerInsightsRoutes(app);
  await registerProjectsRoutes(app);
  await registerArtifactsRoutes(app);
  await registerThreadsRoutes(app);
  await registerCohortsRoutes(app);
  await registerRewardRoutes(app);

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    opts.webDist,
    resolve(here, 'web'),
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
  return { app, host };
}

async function closeQuietly(app: Awaited<ReturnType<typeof buildApp>>['app']): Promise<void> {
  try {
    await app.close();
  } catch {
    // Ignore cleanup errors after a failed listen attempt.
  }
}

export async function startServer(
  opts: ServerOptions = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const startPort = opts.port ?? 0;
  const fallbackAttempts =
    startPort > 0 ? Math.max(0, Math.floor(opts.portFallbackAttempts ?? 0)) : 0;

  for (let offset = 0; offset <= fallbackAttempts; offset++) {
    const { app, host } = await buildApp(opts);
    const port = startPort + offset;
    try {
      const address = await app.listen({ host, port });
      return {
        url: address,
        close: async () => {
          await app.close();
        },
      };
    } catch (err) {
      await closeQuietly(app);
      if (!isAddressInUseError(err) || offset === fallbackAttempts) {
        throw err;
      }
    }
  }

  throw new Error('unreachable');
}
