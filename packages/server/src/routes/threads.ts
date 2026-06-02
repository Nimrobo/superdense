import type { FastifyInstance } from 'fastify';
import { getWorkThread, listWorkThreads, type ThreadLifecycle } from '@nimrobo/superdense-core';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function lifecycleParam(value: string | undefined): ThreadLifecycle | undefined {
  if (value === undefined) return undefined;
  if (value === 'open' || value === 'finalized' || value === 'artifact') return value;
  throw new Error('lifecycle must be open, finalized, or artifact');
}

export async function registerThreadsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/threads', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      return {
        items: listWorkThreads({
          projectId: q.projectId,
          lifecycle: lifecycleParam(q.lifecycle),
        }),
      };
    } catch (err) {
      reply.status(400);
      return { error: errorMessage(err) };
    }
  });

  app.get('/api/threads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const thread = getWorkThread(id);
    if (!thread) {
      reply.status(404);
      return { error: 'not found' };
    }
    return { thread };
  });
}
